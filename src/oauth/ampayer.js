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

// 辅助：生成 authUrl（init 路由和 start 路由都要用）
function buildAuthUrl(loginToken) {
  return `https://api.ampayer.cn/apis/wxauth/init/?site_token=${encodeURIComponent(config.ampayer.siteToken)}&login_token=${encodeURIComponent(loginToken)}`;
}

// 辅助：检测微信 UA
function isWechat(req) {
  const ua = req.headers['user-agent'] || '';
  return /MicroMessenger/i.test(ua);
}

// ========== 路由 ==========

// PC 用：生成 authUrl 返回 JSON，前端画二维码
router.get('/init', async (req, res) => {
  if (!config.ampayer.siteToken) {
    return res.status(500).json({ ok: false, error: 'ampayer_not_configured', message: 'AMPAYER_SITE_TOKEN 未配置' });
  }
  // init 路由同时兼容 H5 —— 如果前端在微信里调了 init，后端直接 302 过去省得前端再跳
  if (isWechat(req)) {
    const loginToken = crypto.randomBytes(16).toString('hex');
    console.log(`[ampayer/init] wechat UA detected, redirecting. login_token=${loginToken}`);
    return res.redirect(buildAuthUrl(loginToken));
  }

  const loginToken = crypto.randomBytes(16).toString('hex');
  console.log(`[ampayer/init] login_token=${loginToken}`);
  res.json({ ok: true, authUrl: buildAuthUrl(loginToken), loginToken });
});

// 微信 H5 专用：302 redirect 到 ampayer 授权页（不返回 JSON）
router.get('/start', (req, res) => {
  if (!config.ampayer.siteToken) {
    return res.redirect('/auth/login?error=ampayer_not_configured');
  }
  const loginToken = crypto.randomBytes(16).toString('hex');
  console.log(`[ampayer/start] redirecting. login_token=${loginToken} wechat=${isWechat(req)}`);
  res.redirect(buildAuthUrl(loginToken));
});

// ampayer 回调（用户扫码授权后 ampayer 跳转到这里）
// ampayer 自动加两个 query 参数：data_token + login_token
// 路径兼容：/auth/ampayer/callback（正常） 和 /auth/wxcallback（误配） 和 /api/auth/wxcallback（旧 Next.js 残留）
async function handleCallback(req, res) {
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
}

// 正常挂载：/auth/ampayer/callback
router.get('/callback', handleCallback);
// 兼容 ampayer 后台误配 /auth/wxcallback 或 /api/auth/wxcallback
router.get('/', handleCallback);

module.exports = router;
