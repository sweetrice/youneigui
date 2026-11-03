'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const config = require('./config');
const { client: redis } = require('./redis');

// Redis 连接状态标记
let redisReady = false;
redis.once('ready', () => { redisReady = true; });

// 等 Redis（最多等 3 秒），连不上也继续启动（开发模式用 MemoryStore）
Promise.race([
  new Promise(resolve => redis.once('ready', resolve)),
  new Promise(resolve => setTimeout(resolve, 3000)),
]).then(() => {
  if (redisReady) {
    console.log('[app] Redis connected, using connect-redis session store');
  } else {
    console.warn('[app] ⚠️  Redis not available, falling back to MemoryStore (dev mode only!)');
  }
  start();
});

function start() {
  const app = express();

  // Session 配置
  const sessionOpts = {
    secret: config.sessionSecret,
    name: 'yg.sid', // 自定义 cookie 名，避免旧 cookie 干扰
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: false, // 允许前端 JS 读取（WebSocket 连接需要 sid 参数）
      maxAge: config.sessionMaxAge * 1000,
      sameSite: 'lax',
    },
  };
  if (redisReady) {
    sessionOpts.store = new (require('connect-redis').default)({ client: redis });
  }
  app.use(session(sessionOpts));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(passport.initialize());
  app.use(passport.session());

  // 安全头 & 自定义
  app.use((req, res, next) => {
    res.header('X-Powered-By', 'YouNeiGui');
    next();
  });

  // 静态文件
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 短链接 → join.html
  app.get('/join/:code', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
  });

  // ========== OAuth 路由 ==========
  app.use('/auth', require('./oauth'));

  // ========== API 路由 ==========
  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      version: '0.1.0',
      redis: redisReady ? 'connected' : 'disconnected',
    });
  });
  app.use('/api/rooms', require('./room/routes'));
  app.use('/api/export', require('./export/routes'));

  // 无 Redis 时的兜底：房间相关路由返回友好错误
  if (!redisReady) {
    app.use(['/api/rooms', '/api/export'], (err, req, res, next) => {
      if (err.message && err.message.includes('ECONNREFUSED')) {
        return res.status(503).json({
          ok: false,
          error: 'redis_unavailable',
          message: 'Redis 未启动，请先启动 Redis 或使用 docker-compose up',
        });
      }
      next(err);
    });
  }

  // ========== WebSocket ==========
  const http = require('http').createServer(app);
  if (redisReady) {
    const { createWebSocketServer } = require('./ws');
    createWebSocketServer(http, redis);
  }

  // ========== 销毁定时器恢复 ==========
  const boot = () => {
    http.listen(config.port, '0.0.0.0', () => {
      // 打印局域网可访问地址
      const nets = require('os').networkInterfaces();
      const lanIp = (Object.values(nets).flat() || []).find(a => a.family === 'IPv4' && !a.internal)?.address || '127.0.0.1';
      console.log(`\n🎬 有内鬼 running on port ${config.port}`);
      console.log(`   本机访问: http://localhost:${config.port}`);
      console.log(`   局域网:  http://${lanIp}:${config.port}`);
      console.log(`   Redis: ${redisReady ? '✅ connected' : '❌ not available (using MemoryStore)'}`);
      console.log(`   GitHub OAuth: ${config.github.clientId ? '✅' : '❌ not configured'}`);
      console.log(`   Weibo  OAuth: ${config.weibo.clientId ? '✅' : '❌ not configured'}`);
      console.log(`   WebSocket: ${redisReady ? '✅' : '❌ disabled (needs Redis)'}\n`);
    });
  };

  if (redisReady) {
    const scheduler = require('./scheduler/destroy');
    scheduler.restore().then(boot);
  } else {
    boot();
  }

  // 优雅退出
  const shutdown = (sig) => {
    console.log(`\n[app] received ${sig}, shutting down...`);
    http.close(() => {
      if (redisReady) redis.quit();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
