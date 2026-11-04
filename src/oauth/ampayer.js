'use strict';

const https = require('https');
const crypto = require('crypto');
const config = require('../config');

// Redis 轮询 key 前缀（ioredis 会自动加 yg:）
const POLL_PREFIX = 'ampayer:poll:';
const POLL_TTL = 5 * 60; // 5 分钟
const H5 = false;

const redis = require('../redis').client;

/**
 * ampayer 微信登录
 *
 * 【PC 扫码流程】—— 两端分离，靠 Redis 轮询串联：
 *   1. PC 浏览器调 /init → 后端生成 login_token，写 Redis（status=pending），返回 authUrl
 *   2. PC 前端画二维码，同时开始轮询 /poll?token=login_token
 *   3. 用户手机微信扫码 → ampayer 授权 → 回调 /callback?data_token=xxx&login_token=yyy
 *   4. callback 里拿 data_token 换 user，写 Redis（status=authorized + user 数据）
 *   5. PC 前端轮询到 authorized → 调 /consume?token=xxx → 后端删 Redis key + 建 PC session
 *   6. PC 前端 reload，已登录 ✅
 *
 * 【微信内置浏览器 H5 流程】—— 同浏览器，直接建 session：
 *   1. 前端点"微信登录" → /start → 302 到 ampayer 授权页
 *   2. 授权完回调 /callback → 直接 req.login() 建 session → 回首页
 *   （不走轮询，因为同浏览器 callback 里建的 session 就是当前浏览器的）
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

function buildAuthUrl(loginToken) {
  return `https://api.ampayer.cn/apis/wxauth/init/?site_token=${encodeURIComponent(config.ampayer.siteToken)}&login_token=${encodeURIComponent(loginToken)}`;
}

function isWechat(req) {
  return /MicroMessenger/i.test(req.headers['user-agent'] || '');
}

function pollKey(token) {
  return `${POLL_PREFIX}${token}`;
}

// ========== 路由 ==========

// 【PC 专用】生成 login_token + 写 Redis pending + 返回 authUrl
// 永远返回 JSON，不 redirect
router.get('/init', async (req, res) => {
  if (!config.ampayer.siteToken) {
    return res.status(500).json({ ok: false, error: 'ampayer_not_configured' });
  }
  const loginToken = crypto.randomBytes(16).toString('hex');
  try {
    await redis.set(pollKey(loginToken), JSON.stringify({ status: 'pending' }), 'EX', POLL_TTL);
    console.log(`[ampayer/init] login_token=${loginToken}`);
    res.json({ ok: true, authUrl: buildAuthUrl(loginToken), loginToken });
  } catch (err) {
    console.error('[ampayer/init] redis write failed:', err.message);
    res.status(500).json({ ok: false, error: 'redis_error' });
  }
});

// 【微信 H5 专用】直接 302 到 ampayer 授权页
// 同浏览器，不走轮询，callback 里直接建 session
router.get('/start', (req, res) => {
  if (!config.ampayer.siteToken) {
    return res.redirect('/auth/login?error=ampayer_not_configured');
  }
  const loginToken = crypto.randomBytes(16).toString('hex');
  console.log(`[ampayer/start] login_token=${loginToken} wechat=${isWechat(req)}`);
  res.redirect(buildAuthUrl(loginToken));
});

// 【PC 专用】前端每 2 秒轮询一次，等手机授权后变成 authorized
router.get('/poll', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });

  try {
    const raw = await redis.get(pollKey(token));
    if (!raw) {
      return res.json({ ok: false, status: 'expired' }); // key 不存在（超时或已 consumed）
    }
    const data = JSON.parse(raw);
    if (data.status === 'pending') {
      return res.json({ ok: false, status: 'pending' });
    }
    if (data.status === 'authorized') {
      return res.json({ ok: true, status: 'authorized', user: data.user });
    }
    if (data.status === 'error') {
      return res.json({ ok: false, status: 'error', message: data.message });
    }
    res.json({ ok: false, status: 'unknown' });
  } catch (err) {
    console.error('[ampayer/poll] error:', err.message);
    res.status(500).json({ ok: false, error: 'redis_error' });
  }
});

// 【PC 专用】消耗轮询 key + 在 PC 浏览器建 session（一次性）
router.post('/consume', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });

  try {
    const raw = await redis.get(pollKey(token));
    if (!raw) return res.status(404).json({ ok: false, error: 'expired' });

    const data = JSON.parse(raw);
    if (data.status !== 'authorized' || !data.user) {
      return res.status(400).json({ ok: false, error: 'not_ready' });
    }

    // 立即删除（一次性，防重放）
    await redis.del(pollKey(token));

    // 在 PC 浏览器里建 session
    const user = data.user;
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('[ampayer/consume] req.login FAILED:', loginErr);
        return res.status(500).json({ ok: false, error: 'session_failed' });
      }
      req.session.save(() => {
        console.log(`[ampayer/consume] ✅ PC logged in ${user.id} session=${req.sessionID}`);
        res.json({ ok: true });
      });
    });
  } catch (err) {
    console.error('[ampayer/consume] error:', err.message);
    res.status(500).json({ ok: false, error: 'redis_error' });
  }
});

// ampayer 回调（用户扫码授权后 ampayer 跳转到这里）
// 路径兼容：/auth/ampayer/callback（正常） 和 /auth/wxcallback（误配） 和 /api/auth/wxcallback（旧残留）
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

  let user;
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
      if (login_token) {
        await redis.set(pollKey(login_token), JSON.stringify({ status: 'error', message: 'ampayer_site_failed' }), 'EX', POLL_TTL);
      }
      return res.redirect('/auth/login?error=ampayer_site_failed');
    }

    const info = resp.json.userinfo || {};
    const openid = info.openid;
    if (!openid) {
      console.error('[ampayer/callback] no openid');
      if (login_token) {
        await redis.set(pollKey(login_token), JSON.stringify({ status: 'error', message: 'no_openid' }), 'EX', POLL_TTL);
      }
      return res.redirect('/auth/login?error=ampayer_no_openid');
    }

    user = {
      id: `wx_${openid}`,
      nickname: info.nickname || '微信用户',
      avatar: info.headimgurl || '',
      oauthProvider: 'wechat',
    };
  } catch (err) {
    console.error('[ampayer/callback] ERROR:', err.message);
    if (login_token) {
      await redis.set(pollKey(login_token), JSON.stringify({ status: 'error', message: err.message }), 'EX', POLL_TTL);
    }
    return res.redirect('/auth/login?error=ampayer_exception');
  }

  // ========== 关键分支 ==========
  // 如果 callback 带了 login_token → PC 扫码流程 → 写 Redis 让 PC poll
  // 如果没带 login_token → 微信 H5 流程 → 直接 req.login() 建当前浏览器 session
  if (login_token) {
    // PC 扫码：写 Redis 让 PC 端 poll 到 user 信息
    try {
      await redis.set(
        pollKey(login_token),
        JSON.stringify({ status: 'authorized', user }),
        'EX', POLL_TTL
      );
      console.log(`[ampayer/callback] ✅ poll key updated for PC. login_token=${login_token} user=${user.id}`);
    } catch (err) {
      console.error('[ampayer/callback] redis write failed:', err.message);
      return res.redirect('/auth/login?error=redis_write_failed');
    }

    // 手机端显示一个"授权成功，回到电脑确认登录"的过渡页
    // 这样 ampayer 回调不会停在空白或错误页面
    res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权成功</title><style>
body{margin:0;font-family:-apple-system,sans-serif;background:#0f0f1a;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{text-align:center;padding:40px 32px}
.icon{font-size:48px;margin-bottom:16px}
h2{margin:0 0 8px;font-size:1.2rem}
p{margin:0;color:#888;font-size:0.9rem;line-height:1.6}
</style></head><body><div class="box"><div class="icon">✅</div><h2>授权成功</h2><p>请回到电脑浏览器<br>确认登录状态</p></div></body></html>`);
  } else {
    // 微信 H5：同浏览器，直接建 session
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('[ampayer/callback] req.login FAILED:', loginErr);
        return res.redirect('/auth/login?error=session_save_failed');
      }
      console.log(`[ampayer/callback] ✅ H5 logged in ${user.id} session=${req.sessionID}`);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[ampayer/callback] session save failed:', saveErr);
        res.redirect('/');
      });
    });
  }
}

// 正常挂载 + 兼容误配路径
router.get('/callback', handleCallback);
router.get('/', handleCallback);

module.exports = router;
