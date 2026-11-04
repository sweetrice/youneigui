'use strict';

const Redis = require('ioredis');
const config = require('./config');

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  // 重连策略：最多 30 秒，超过就放弃
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    if (times > 10) return null; // 停止重连
    return delay;
  },
  maxRetriesPerRequest: null,
};

// 业务 client：带 keyPrefix，日常操作自动加前缀
const client = new Redis({ ...redisOpts, keyPrefix: config.redisPrefix });

// 原始 client：不带 keyPrefix，给需要扫描原始 key 的场景用（SCAN/KEYS 等）
// ioredis 的 keyPrefix 在 keys()/scan() 上有已知 bug，某些版本下 pattern 拼接错误
const rawClient = new Redis({ ...redisOpts });

client.on('connect', () => console.log('[redis] connected'));
client.on('ready', () => console.log('[redis] ready'));
client.on('error', (err) => console.error('[redis] error:', err.message));
rawClient.on('connect', () => {}); // 静默
rawClient.on('ready', () => {});
rawClient.on('error', (err) => console.error('[redis/raw] error:', err.message));

/**
 * 销毁消息时同步清理关联的 Redis key
 * 用 rawClient 扫描（绕开 ioredis keys 的 prefix bug），用 client.del 正常删除
 */
async function destroyRoomKeys(roomId) {
  try {
    // rawClient 返回带完整 prefix 的 key
    const keys = await rawClient.keys(`${config.redisPrefix}room:${roomId}*`);
    if (keys.length > 0) {
      // client.del 会自动加 prefix，但 keys 已经带了 prefix → 会二次拼接
      // 需要 slice 掉 prefix 再传给带 prefix 的 client
      const rawKeys = keys.map(k => k.slice(config.redisPrefix.length));
      await client.del(...rawKeys);
    }
    // 清理成员索引（client.smembers 自动加 prefix）
    const members = await client.smembers(`room:${roomId}:members`);
    for (const memberId of members) {
      await client.del(`room:${roomId}:member:${memberId}`);
    }
    console.log(`[redis] destroyed all keys for room ${roomId}`);
  } catch (e) {
    console.error('[redis] destroyRoomKeys error:', e);
  }
}

module.exports = { client, rawClient, destroyRoomKeys };
