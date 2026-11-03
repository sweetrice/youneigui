'use strict';

const router = require('express').Router();
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const WeiboStrategy = require('passport-weibo').Strategy;
const config = require('../config');

// 通用 OAuth 用户序列化（存入 session）
passport.serializeUser((user, done) => {
  done(null, {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    oauthProvider: user.oauthProvider,
  });
});
passport.deserializeUser((user, done) => done(null, user));

// ========== GitHub ==========
if (config.github.clientId && config.github.clientSecret) {
  passport.use(new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: config.github.callbackURL,
  }, (accessToken, refreshToken, profile, done) => {
    // profile.id = GitHub numeric ID, profile.username = login, profile.displayName = name
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

// ========== Weibo ==========
if (config.weibo.clientId && config.weibo.clientSecret) {
  passport.use(new WeiboStrategy({
    clientID: config.weibo.clientId,
    clientSecret: config.weibo.clientSecret,
    callbackURL: config.weibo.callbackURL,
  }, (accessToken, refreshToken, profile, done) => {
    done(null, {
      id: `wb_${profile.id}`,
      nickname: profile.displayName || '微博用户',
      avatar: profile._json && profile._json.avatar_large
        ? profile._json.avatar_large
        : (profile._json && profile._json.profile_image_url ? profile._json.profile_image_url : ''),
      oauthProvider: 'weibo',
    });
  }));
  console.log('[oauth] Weibo strategy registered');
} else {
  console.warn('[oauth] Weibo credentials not configured, skipping');
}

// ========== 路由 ==========

// 登录入口
router.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>有内鬼 · 登录</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}
h1{font-size:1.5rem;margin-bottom:0.5rem}
.sub{color:#aaa;margin-bottom:2rem;font-size:0.9rem;text-align:center;max-width:320px;padding:0 1rem}
.btn{display:block;width:260px;padding:14px 20px;margin:10px 0;border:none;border-radius:10px;font-size:1rem;cursor:text-decoration:none;color:#fff;text-align:center}
.btn-github{background:#24292f}
.btn-github:hover{background:#2f3640}
.btn-weibo{background:#e6162d}
.btn-weibo:hover{background:#ff2a45}
.note{font-size:0.75rem;color:#666;margin-top:2rem;text-align:center;padding:0 1rem}
</style></head>
<body>
<h1>有内鬼 🎬</h1>
<p class="sub">登录以创建或加入临时会话，聊完即焚，不沉淀任何社交关系</p>
${config.github.clientId ? '<a class="btn btn-github" href="/auth/github">使用 GitHub 登录</a>' : ''}
${config.weibo.clientId ? '<a class="btn btn-weibo" href="/auth/weibo">使用微博登录</a>' : ''}
${!config.github.clientId && !config.weibo.clientId ? '<p style="color:#888">OAuth 尚未配置，请联系管理员</p>' : ''}
<p class="note">我们仅存储你的昵称和头像用于会话内展示，销毁后立即清除</p>
</body></html>`);
});

// GitHub
router.get('/github', passport.authenticate('github'));
router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: '/auth/login?error=oauth_failed' }),
  (req, res) => res.redirect('/')
);

// Weibo
router.get('/weibo', passport.authenticate('weibo'));
router.get('/weibo/callback',
  passport.authenticate('weibo', { failureRedirect: '/auth/login?error=oauth_failed' }),
  (req, res) => res.redirect('/')
);

// 当前用户信息
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json(req.session.user);
  }
  res.json(null);
});

// 登出
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
