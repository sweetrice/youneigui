'use strict';

/**
 * 登录校验中间件
 * 未登录返回 401，前端自行跳转到登录页
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  return res.redirect('/login.html');
}

/**
 * 当前用户信息（公开接口，未登录也能访问）
 */
function attachUser(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
}

module.exports = { requireAuth, attachUser };
