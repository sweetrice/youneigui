'use strict';

const router = require('express').Router();
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const config = require('../config');

// ========== 动态构建 callbackURL ==========
// 优先用 config 里配好的固定值（正式服务器有 nginx 反代头，但本地没有）
// 只有 config 没配时才从请求头动态拼（兜底）
function buildCallbackUrl(req, provider) {
  if (provider === 'github' && config.github.callbackURL) {
    return config.github.callbackURL;
  }
  const host = req.headers.host;
  const protocol = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${protocol}://${host}/auth/${provider}/callback`;
}

// ========== Passport Session 序列化 ==========
passport.serializeUser((user, done) => {
  done(null, {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    oauthProvider: user.oauthProvider,
  });
});
passport.deserializeUser((user, done) => {
  if (!user) return done(null, null);
  done(null, user);
});

// ========== GitHub ==========
if (config.github.clientId && config.github.clientSecret) {
  passport.use(new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
  }, (accessToken, refreshToken, profile, done) => {
    console.log(`[oauth/github] callback OK: id=${profile.id}, name=${profile.displayName || profile.username}`);
    done(null, {
      id: `gh_${profile.id}`,
      nickname: profile.displayName || profile.username || 'GitHub 用户',
      avatar: profile._json && profile._json.avatar_url ? profile._json.avatar_url : '',
      oauthProvider: 'github',
    });
  }));
  console.log('[oauth] GitHub strategy registered');
} else {
  console.warn('[oauth] GitHub credentials not configured, skipping');
}

// ========== 路由 ==========

// 登录入口
router.get('/login', (req, res) => {
  const error = req.query.error;
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>有内鬼 · 登录</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}
h1{font-size:1.5rem;margin-bottom:0.5rem}
.sub{color:#aaa;margin-bottom:2rem;font-size:0.9rem;text-align:center;max-width:320px;padding:0 1rem}
.btn{display:block;width:260px;padding:14px 20px;margin:10px 0;border:none;border-radius:10px;font-size:1rem;cursor:pointer;text-decoration:none;color:#fff;text-align:center}
.btn-github{background:#24292f}
.btn-github:hover{background:#2f3640}
.btn-wechat{background:#07c160}
.btn-wechat:hover{background:#06ae56}
.btn-secondary{background:#16213e}
.btn-secondary:hover{background:#1f2d52}
.note{font-size:0.75rem;color:#666;margin-top:2rem;text-align:center;padding:0 1rem}
.err{background:#c0392b;padding:12px 20px;border-radius:8px;margin-bottom:16px;font-size:0.85rem;max-width:320px;text-align:center}
</style></head>
<body>
<h1>有内鬼 🎬</h1>
<p class="sub">登录以创建或加入临时会话，聊完即焚，不沉淀任何社交关系</p>
${error ? '<div class="err">❌ 登录失败，请重试</div>' : ''}
<div style="display:flex;gap:8px;width:260px;margin:10px 0">
${config.github.clientId ? '<a class="btn btn-github" href="/auth/github" style="flex:1;margin:0">GitHub 登录</a>' : ''}
</div>
${process.env.NODE_ENV !== 'production' ? '<a class="btn btn-secondary" href="/auth/mock?name=测试用户">🧪 Mock 登录（开发）</a>' : ''}
${!config.github.clientId ? '<p style="color:#888">OAuth 尚未配置，请联系管理员</p>' : ''}
<p class="note">我们仅存储你的昵称和头像用于会话内展示，销毁后立即清除</p>
</body></html>`);
});

// ========== Mock 登录（仅开发环境） ==========
if (process.env.NODE_ENV !== 'production') {
  router.get('/mock', (req, res) => {
    const name = (req.query.name || 'Mock 用户').toString();
    const user = {
      id: `mock_${Date.now()}`,
      nickname: name,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
      oauthProvider: 'mock',
    };
    req.login(user, (err) => {
      if (err) { console.error('[oauth/mock] login failed:', err); return res.redirect('/auth/login?error=mock_failed'); }
      console.log(`[oauth/mock] logged in as ${user.id} (${user.nickname})`);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[oauth/mock] session save failed:', saveErr);
        res.redirect('/create.html');
      });
    });
  });
  console.log('[oauth] Mock login enabled (dev mode)');
}

// GitHub — 进入授权
router.get('/github', (req, res, next) => {
  const callbackURL = buildCallbackUrl(req, 'github');
  console.log(`[oauth/github] redirecting to GitHub... callbackURL=${callbackURL}`);
  passport.authenticate('github', { callbackURL })(req, res, next);
});

// GitHub — 回调
router.get('/github/callback', (req, res, next) => {
  const callbackURL = buildCallbackUrl(req, 'github');
  passport.authenticate('github', { callbackURL, session: true }, (err, user, info) => {
    console.log('[oauth/github] callback args: err=', err ? err.message : null, 'user=', user ? user.id : null, 'info=', info);
    if (err) {
      console.error('[oauth/github] ERROR:', err.message);
      if (err.oauthError) console.error('[oauth/github] oauthError:', err.oauthError);
      return res.redirect('/auth/login?error=oauth_failed');
    }
    if (!user) return res.redirect('/auth/login?error=no_user');
    req.login(user, (loginErr) => {
      if (loginErr) { console.error('[oauth/github] req.login FAILED:', loginErr); return res.redirect('/auth/login?error=session_save_failed'); }
      console.log(`[oauth/github] ✅ logged in ${user.id} session=${req.sessionID}`);
      req.session.save((saveErr) => {
        if (saveErr) console.error('[oauth/github] session save failed:', saveErr);
        res.redirect('/create.html');
      });
    });
  })(req, res, next);
});

// 当前用户信息
router.get('/me', (req, res) => {
  const user = req.user || (req.session && req.session.passport && req.session.passport.user);
  if (user) return res.json(user);
  res.json(null);
});

// 登出
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('yg.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
