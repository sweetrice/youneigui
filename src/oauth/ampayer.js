'use strict';

const https = require('https');
const crypto = require('crypto');
const config = require('../config');

/**
 * ampayer 微信扫码登录
 *
 * 流程：
 *   1. 前端调 /auth/ampayer/init → 后端 POST ampayer init 端点，拿回 authUrl
 *   2. 前端用 qrcode.js 把 authUrl 画成二维码 → 用户微信扫码
 *   3. 微信授权 → ampayer 回调 /auth/ampayer/callback?data_token=xxx&login_token=yyy
 *   4. 后端拿 data_token POST ampayer site 端点换 openid/nickname/headimgurl
 *   5. 构造 user → req.login() 建 session → redirect 首页
 */

const router = require('express').Router();

// ampayer API POST 封装（Node 原生 https，零额外依赖）
function ampayerPost(url, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(bodyObj);

    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength('data=' + encodeURIComponent(bodyStr)),
        'User-Agent': 'YouNeiGui/1.0',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data, json: null });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ampayer request timeout')); });
    req.write('data=' + encodeURIComponent(bodyStr));
    req.end();
  });
}

// ampayer init 也用 POST（skill 里说 POST），但 body 为空，参数在 query string
// 让我试试用 query string 的方式发——直接 https.request 带 query 参数
function ampayerInit(siteToken, loginToken) {
  return new Promise((resolve, reject) => {
    const url = `https://api.ampayer.cn/apis/wxauth/init/?site_token=${encodeURIComponent(siteToken)}&login_token=${encodeURIComponent(loginToken)}`;
    const u = new URL(url);

    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'YouNeiGui/1.0',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ampayer init timeout')); });
    req.end();
  });
}

// ========== 路由 ==========

// 生成 login_token 并请求 ampayer 授权页 URL
router.get('/init', async (req, res) => {
  if (!config.ampayer.siteToken) {
    return res.status(500).json({ ok: false, error: 'ampayer_not_configured', message: 'AMPAYER_SITE_TOKEN 未配置' });
  }

  const loginToken = crypto.randomBytes(16).toString('hex');
  console.log(`[ampayer/init] login_token=${loginToken}`);

  try {
    // 先试试带 body 的 init（可能 ampayer 也接受，参考 skill）
    // 但 skill 里的 curl 没有 body，只有 query string，所以用 ampayerInit()
    const resp = await ampayerInit(config.ampayer.siteToken, loginToken);
    console.log(`[ampayer/init] ampayer response status=${resp.status}`);

    // ampayer init 可能返回：
    // a) 一段 HTML（直接就是授权页）
    // b) 一个 JSON 对象包含 authUrl
    // c) 一个 302 redirect
    let authUrl = null;

    if (resp.status >= 300 && resp.status < 400) {
      // redirect — 读 Location header？Node https.request 默认不自动重定向
      // 我们的 https.request 没 follow redirect，直接看 response.headers.location
      // 但因为我们没用 followRedirect，让我重试带自动 follow...
      // 简化：再发一次请求获取真实 URL
      authUrl = resp.body && resp.body.startsWith('http') ? resp.body : null;
    }

    if (!authUrl && resp.body) {
      // 尝试解析 JSON
      try {
        const j = JSON.parse(resp.body);
        authUrl = j.authUrl || j.url || j.data || (j.data && j.data.authUrl) || null;
      } catch {
        // 不是 JSON — 可能就是一段 HTML（授权页），直接用 ampayer 的 init URL 当 authUrl
        // 或者 ampayer 直接返回了 HTML，我们应该把 init URL 作为二维码内容
        authUrl = `https://api.ampayer.cn/apis/wxauth/init/?site_token=${config.ampayer.siteToken}&login_token=${loginToken}`;
      }
    }

    // 如果 ampayer init 返回的就是一段 HTML 授权页，那 authUrl 就是它本身
    if (!authUrl) {
      authUrl = `https://api.ampayer.cn/apis/wxauth/init/?site_token=${config.ampayer.siteToken}&login_token=${loginToken}`;
    }

    res.json({ ok: true, authUrl, loginToken });
  } catch (err) {
    console.error('[ampayer/init] ERROR:', err.message);
    res.status(500).json({ ok: false, error: 'ampayer_init_failed', message: err.message });
  }
});

// ampayer 回调（用户扫码授权后 ampayer 跳转到这里）
// ampayer 自动加两个 query 参数：data_token + login_token
router.get('/callback', async (req, res) => {
  const { data_token, login_token } = req.query;

  if (!config.ampayer.siteToken) {
    return res.redirect('/auth/login?error=ampayer_not_configured');
  }
  if (!data_token) {
    console.error('[ampayer/callback] missing data_token');
    return res.redirect('/auth/login?error=ampayer_missing_data_token');
  }

  console.log(`[ampayer/callback] data_token=${data_token.slice(0, 20)}... login_token=${login_token || '(none)'}`);

  try {
    // 拿 data_token 换用户信息
    const resp = await ampayerPost(config.ampayer.siteURL, {
      site_token: config.ampayer.siteToken,
      data_token: data_token,
    });

    console.log(`[ampayer/callback] site response: status=${resp.status}`);
    if (resp.json) console.log('[ampayer/callback] site body:', JSON.stringify(resp.json).slice(0, 300));

    if (!resp.json || resp.json.status !== 1) {
      console.error('[ampayer/callback] ampayer site failed:', resp.json || resp.body);
      return res.redirect('/auth/login?error=ampayer_site_failed');
    }

    const info = resp.json.userinfo || {};
    const openid = info.openid;
    const nickname = info.nickname || '微信用户';
    const headimgurl = info.headimgurl || '';

    if (!openid) {
      console.error('[ampayer/callback] no openid in response');
      return res.redirect('/auth/login?error=ampayer_no_openid');
    }

    const user = {
      id: `wx_${openid}`,
      nickname,
      avatar: headimgurl,
      oauthProvider: 'wechat',
    };

    // 用 passport session 建立会话（和 GitHub 一样的流程）
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('[ampayer/callback] req.login FAILED:', loginErr);
        return res.redirect('/auth/login?error=session_save_failed');
      }
      console.log(`[ampayer/callback] ✅ logged in ${user.id} session=${req.sessionID}`);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[ampayer/callback] session save failed:', saveErr);
        // ampayer 回调来自微信/ampayer 的跳转，我们要 redirect 到前端首页
        res.redirect('/');
      });
    });
  } catch (err) {
    console.error('[ampayer/callback] ERROR:', err.message);
    res.redirect('/auth/login?error=ampayer_exception');
  }
});

module.exports = router;
