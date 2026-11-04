'use strict';

// 简易 .env 读取（避免引入 dotenv 依赖）
function loadEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        // 去掉引号
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    // 忽略
  }
}

loadEnv();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',

  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/github/callback`,
  },

  // ========== Ampayer 微信扫码登录 ==========
  // 在 ampayer 后台申请 site_token，绑定到你的公网域名
  // 回调地址必须和申请时填的一致：${APP_URL}/auth/ampayer/callback
  ampayer: {
    siteToken: process.env.AMPAYER_SITE_TOKEN || '',
    initURL: 'https://api.ampayer.cn/apis/wxauth/init/',
    siteURL: 'https://api.ampayer.cn/apis/wxauth/site/',
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/ampayer/callback`,
  },

  // 预设销毁时间（秒）
  destroyPresets: [
    { label: '30 分钟', seconds: 30 * 60 },
    { label: '2 小时', seconds: 2 * 60 * 60 },
    { label: '6 小时', seconds: 6 * 60 * 60 },
    { label: '24 小时', seconds: 24 * 60 * 60 },
    { label: '3 天', seconds: 3 * 24 * 60 * 60 },
    { label: '7 天', seconds: 7 * 24 * 60 * 60 },
  ],

  // 自定义销毁时间范围（秒）
  destroyMin: 10 * 60,       // 10 分钟
  destroyMax: 30 * 24 * 60 * 60, // 30 天

  // 房间码生成
  codeLength: 7,
  codeChars: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // 排除 0/O/1/I

  // Redis key 前缀
  redisPrefix: 'yg:',

  // 登录 session 有效期（秒）
  sessionMaxAge: 7 * 24 * 60 * 60, // 7 天
};
