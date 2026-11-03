'use strict';

const Redis = require('ioredis');
const config = require('./config');

const client = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  keyPrefix: config.redisPrefix,
  // 重连策略：最多 30 秒，超过就放弃
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    if (times > 10) return null; // 停止重连
    return delay;
  },
  maxRetriesPerRequest: null,
});

client.on('connect', () => console.log('[redis] connected'));
client.on('ready', () => console.log('[redis] ready'));
client.on('error', (err) => console.error('[redis] error:', err.message));

/**
 * 销毁消息时同步清理关联的 Redis key
 * @param {string} roomId
 */
async function destroyRoomKeys(roomId) {
  try {
    const keys = await client.keys(`${config.redisPrefix}room:${roomId}*`);
    // ioredis keys 返回的是带 prefix 的，但 Redis 命令里 key 不带 prefix
    const rawKeys = keys.map(k => k.slice(config.redisPrefix.length));
    if (rawKeys.length > 0) {
      await client.del(...rawKeys);
    }
    // 清理成员索引
    const members = await client.smembers(`room:${roomId}:members`);
    for (const memberId of members) {
      await client.del(`room:${roomId}:member:${memberId}`);
    }
    console.log(`[redis] destroyed all keys for room ${roomId}`);
  } catch (e) {
    console.error('[redis] destroyRoomKeys error:', e);
  }
}

module.exports = { client, destroyRoomKeys };
