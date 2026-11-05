'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const config = require('./config');
const { client: redis, rawClient } = require('./redis');
const multer = require('multer');
const mediaStore = require('./media/store');

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
    if (process.env.NODE_ENV === 'production') {
      console.error('[app] ❌ Redis is required in production. Aborting.');
      process.exit(1);
    }
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

  // ========== 媒体文件静态目录（仅启用了存储时挂载） ==========
  const mediaEnabled = !!config.mediaStorageRoot;
  if (mediaEnabled) {
    const mediaCache = (req, res, next) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      next();
    };
    app.use('/media', mediaCache, express.static(config.mediaStorageRoot, {
      acceptRanges: true,
      dotfiles: 'deny',
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    }));
    console.log(`[media] storage enabled at ${config.mediaStorageRoot}`);
  } else {
    console.warn('[media] ⚠️  MEDIA_STORAGE_ROOT not set, media upload disabled');
  }

  // ========== 媒体上传接口 ==========
  // 仅当配置了 MEDIA_STORAGE_ROOT 时才挂载
  if (mediaEnabled) {
    const tmpDir = path.join(require('os').tmpdir(), 'youneigui-upload');
    const uploadHandler = multer({
      dest: tmpDir,
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
        if (mediaStore.MIME_LIMITS[file.mimetype]) cb(null, true);
        else cb(new Error('invalid_mime'));
      },
    });

    app.post('/api/media/upload', uploadHandler.single('file'), async (req, res) => {
      console.log(`[media/upload] file=${req.file ? req.file.originalname : 'none'}`);
      if (!redisReady) return res.status(503).json({ ok: false, error: 'redis_unavailable' });
      if (!req.user) return res.status(401).json({ ok: false, error: 'not_logged_in' });
      const roomId = req.body.roomId;
      if (!roomId) return res.status(400).json({ ok: false, error: 'missing_roomId' });
      if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
      try {
        const status = await redis.hget(`room:meta:${roomId}`, 'status');
        if (status !== 'active') {
          try { require('fs').unlinkSync(req.file.path); } catch {}
          return res.status(410).json({ ok: false, error: 'room_destroyed' });
        }
        const result = await mediaStore.upload(roomId, req.file);
        res.json({ ok: true, ...result });
      } catch (e) {
        console.error('[media/upload] error:', e.message);
        if (e.message === 'room_quota_exceeded') return res.status(413).json({ ok: false, error: 'quota_exceeded', detail: e.detail });
        if (e.message === 'too_large') return res.status(413).json({ ok: false, error: 'too_large', detail: e.detail });
        if (e.message === 'type_not_allowed') return res.status(415).json({ ok: false, error: 'type_not_allowed', detail: e.detail });
        res.status(500).json({ ok: false, error: 'upload_failed' });
      }
    });
  }

  // 全局请求日志（仅 /api 路径）

  // 短链接 → join.html
  app.get('/join/:code', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
  });

  // ========== OAuth 路由 ==========
  const oauthRouter = require('./oauth');
  app.use('/auth', oauthRouter);

  // ========== API 路由 ==========
  // 健康检查 + 服务器时间校准（前端用来修正服务器时间漂移）
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      version: '0.1.0',
      redis: redisReady ? 'connected' : 'disconnected',
      mediaEnabled: mediaEnabled,
      serverTime: Date.now(),
    });
  });
  app.use('/api/rooms', require('./room/routes'));
  app.use('/api/export', require('./export/routes'));

  // ========== 审计统计（公开，数据已脱敏）==========
  app.get('/api/stats', async (req, res) => {
    if (!redisReady) return res.status(503).json({ ok: false, error: 'redis_unavailable' });
    try {
      // 1. 活跃房间数 + 活跃房间的消息/成员数
      // 用 rawClient（不带 keyPrefix）+ SCAN，绕开 ioredis keyPrefix 在 keys()/scan() 上的 bug
      let activeRooms = 0;
      let activeMessages = 0;
      let activeMembers = 0;
      const fullPattern = `${config.redisPrefix}room:meta:*`;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await rawClient.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const fullKey of keys) {
          // fullKey 是完整的（yg:room:meta:xxx），用带 prefix 的 redis 操作要 slice 掉 prefix
          const rawKey = fullKey.slice(config.redisPrefix.length);
          const status = await redis.hget(rawKey, 'status');
          if (status === 'active') {
            activeRooms++;
            const roomId = rawKey.replace(/^room:meta:/, '');
            // 活跃房间的消息数（List length）和成员数（Set scard）
            const [msgLen, memLen] = await Promise.all([
              redis.llen(`room:${roomId}:messages`),
              redis.scard(`room:${roomId}:members`),
            ]);
            activeMessages += msgLen || 0;
            activeMembers += memLen || 0;
          }
        }
      } while (cursor !== '0');

      // 2. 审计日志汇总（已销毁房间）
      // 先清理 90 天前的过期项（ZSET score=destroy_at 时间戳）
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - NINETY_DAYS_MS;
      await redis.zremrangebyscore('audit:rooms', '-inf', cutoff);

      // ZREVRANGE 按 score 降序取（最新的在前），全量读做汇总（90 天内不会太多）
      const rawLogs = await redis.zrevrange('audit:rooms', 0, -1);
      const logs = rawLogs.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

      const totalMessagesFromLogs = logs.reduce((s, l) => s + (l.message_count || 0), 0);
      const totalMembersFromLogs = logs.reduce((s, l) => s + (l.member_count || 0), 0);

      const summary = {
        totalRooms: logs.length + activeRooms,
        activeRooms,
        destroyedRooms: logs.length,
        totalMessages: totalMessagesFromLogs + activeMessages,
        totalMembers: totalMembersFromLogs + activeMembers,
        manualDestroy: logs.filter(l => l.destroy_trigger === 'manual').length,
        autoDestroy: logs.filter(l => l.destroy_trigger === 'auto').length,
        avgMembersPerRoom: logs.length ? +((totalMembersFromLogs) / logs.length).toFixed(1) : (activeRooms ? +(activeMembers / activeRooms).toFixed(1) : 0),
        avgMessagesPerRoom: logs.length ? +((totalMessagesFromLogs) / logs.length).toFixed(1) : (activeRooms ? +(activeMessages / activeRooms).toFixed(1) : 0),
      };

      // 3. 最近 20 条明细
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const recent = logs.slice(0, limit).map(l => ({
        roomId: l.room_id,
        destroyAt: l.destroy_at,
        destroyTrigger: l.destroy_trigger,
        destroyActorRole: l.destroy_actor_role,
        memberCount: l.member_count,
        messageCount: l.message_count,
      }));

      res.json({ ok: true, summary, recent });
    } catch (e) {
      console.error('[api/stats] error:', e.message);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

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
