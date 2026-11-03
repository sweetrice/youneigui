'use strict';

/**
 * 登录校验中间件
 * passport 标准：user 存于 req.user（passport.session() 中间件反序列化）
 */
function requireAuth(req, res, next) {
  const user = req.user || (req.session && req.session.passport && req.session.passport.user);
  if (user) {
    req.user = user;
    return next();
  }
  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  return res.redirect('/auth/login');
}

/**
 * 当前用户信息（公开接口，未登录也能访问）
 */
function attachUser(req, res, next) {
  const user = req.user || (req.session && req.session.passport && req.session.passport.user);
  if (user) {
    req.user = user;
  }
  next();
}

module.exports = { requireAuth, attachUser };
