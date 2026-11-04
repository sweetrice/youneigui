'use strict';

const { client, rawClient } = require('../redis');
const config = require('../config');
// 注意：这里**不要**顶层 require('../room/manager')，会循环依赖
// manager.js 顶层 require 了本文件 → 此时本文件还没执行到底
// 所以改成函数内懒加载

/**
 * 销毁定时器 + 三级提醒 + 周期性兜底检查
 *
 * 设计：
 * - 用 setTimeout 做精确到秒的定时，destroy_at 到达时立即执行销毁
 * - 同时注册 3 个提醒定时器（1h / 10min / 1min 剩余时触发）
 * - 每 10 秒扫一遍所有已注册的定时器，兜底检查：
 *     1. destroyAt 已过但 setTimeout 还没触发 → 立即销毁
 *     2. 房间 Redis 元数据已变成 destroyed → cancel 对应的 timer
 * - 如果服务器重启，从 Redis 里扫一遍所有 status=active 的 room 重建定时器
 */

const timers = new Map(); // roomId -> { destroy, reminders: [] }

// 兜底检查定时器
let guardInterval = null;
const GUARD_INTERVAL_MS = 10 * 1000; // 10 秒

// 懒加载 roomManager（打破循环依赖）
// manager.js 在顶层 require 本文件，本文件顶层再 require manager 就会拿到空 exports
// 所以用 getter，等真正运行时再加载——那时 manager.js 早就完成了
let _roomManager = null;
function roomMgr() {
  if (!_roomManager) _roomManager = require('../room/manager');
  return _roomManager;
}

// 提醒节点（剩余多少秒时触发）
const REMINDERS = [
  { label: '1h', offsetFromEnd: 60 * 60, type: 'remind_1h' },
  { label: '10min', offsetFromEnd: 10 * 60, type: 'remind_10min' },
  { label: '1min', offsetFromEnd: 60, type: 'remind_1min' },
];

/**
 * 注册销毁定时器
 */
async function register(roomId, destroyAt) {
  await cancel(roomId);

  const now = Date.now();
  const destroyDelay = destroyAt - now;

  const record = { destroyAt, destroy: null, reminders: [] };

  // 销毁定时器
  record.destroy = setTimeout(async () => {
    console.log(`[scheduler] auto-destroy trigger for ${roomId}`);
    await roomMgr().destroyRoom(roomId, null, 'auto');
    timers.delete(roomId);
  }, Math.max(0, destroyDelay));

  // 三级提醒
  for (const r of REMINDERS) {
    const reminderAt = destroyAt - r.offsetFromEnd * 1000;
    const reminderDelay = reminderAt - now;
    if (reminderDelay > 0 && reminderDelay <= destroyDelay) {
      const timer = setTimeout(async () => {
        await notifyReminder(roomId, r.type, r.offsetFromEnd);
      }, reminderDelay);
      record.reminders.push(timer);
    }
  }

  timers.set(roomId, record);
  console.log(`[scheduler] registered ${roomId} destroyAt=${new Date(destroyAt).toISOString()}`);
}

/**
 * 取消定时器
 */
async function cancel(roomId) {
  const record = timers.get(roomId);
  if (record) {
    if (record.destroy) clearTimeout(record.destroy);
    for (const t of record.reminders) clearTimeout(t);
    timers.delete(roomId);
  }
}

/**
 * 周期性兜底检查（每 GUARD_INTERVAL_MS 执行一次）
 *
 * 扫一遍所有已注册的 room：
 *   1. destroyAt 已过但 setTimeout 还没触发 → 手动调 destroyRoom
 *   2. Redis 中房间已 destroyed → cancel timer（说明手动销毁已发生）
 */
function startGuard() {
  if (guardInterval) return;
  guardInterval = setInterval(async () => {
    if (timers.size === 0) return;
    const now = Date.now();
    for (const [roomId, record] of timers) {
      try {
        // 检查 Redis 状态（可能已经手动销毁了）
        const meta = await client.hgetall(`room:meta:${roomId}`);
        if (!meta || meta.status === 'destroyed') {
          console.log(`[scheduler][guard] room ${roomId} already destroyed in Redis, cleaning timer`);
          cancel(roomId);
          continue;
        }
        // destroyAt 已过但 setTimeout 还没触发 → 兜底销毁
        if (record.destroyAt <= now) {
          console.log(`[scheduler][guard] room ${roomId} past destroyAt, force destroying (destroyAt=${new Date(record.destroyAt).toISOString()}, now=${new Date(now).toISOString()})`);
          await cancel(roomId);
          await roomMgr().destroyRoom(roomId, null, 'auto');
        }
      } catch (e) {
        console.error(`[scheduler][guard] error for ${roomId}:`, e.message);
      }
    }
  }, GUARD_INTERVAL_MS);
  console.log(`[scheduler][guard] started, checking every ${GUARD_INTERVAL_MS / 1000}s`);
}

/**
 * 通知提醒事件（通过 Redis Pub/Sub 推给 WebSocket 层）
 */
async function notifyReminder(roomId, type, remainingSeconds) {
  const labels = {
    remind_1h: '会话将在 1 小时后自动销毁，如需继续请创建者延长销毁时间',
    remind_10min: '会话将在 10 分钟后自动销毁',
    remind_1min: '⚠️ 会话将在 1 分钟后自动销毁，请尽快导出或主动结束',
  };
  await client.publish('room:event', JSON.stringify({
    type,
    room_id: roomId,
    message: labels[type] || '',
    remaining_seconds: remainingSeconds,
  }));
  console.log(`[scheduler] reminder ${type} for ${roomId}`);
}

/**
 * 服务器启动时重建所有活跃房间的定时器
 * 扫 Redis 中所有 room:meta:* 的 key
 */
async function restore() {
  // 用 rawClient 绕开 ioredis keyPrefix 在 keys() 上的 bug
  const fullPattern = `${config.redisPrefix}room:meta:*`;
  let cursor = '0';
  let restored = 0;
  let expired = 0;
  do {
    const [nextCursor, fullKeys] = await rawClient.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
    cursor = nextCursor;
    for (const fullKey of fullKeys) {
      const rawKey = fullKey.slice(config.redisPrefix.length);
      const meta = await client.hgetall(rawKey);
      if (meta && meta.status === 'active' && meta.destroy_at) {
        const destroyAt = Number(meta.destroy_at);
        if (destroyAt > Date.now()) {
          await register(meta.room_id, destroyAt);
          restored++;
        } else {
          console.log(`[scheduler] found expired room ${meta.room_id}, destroying now`);
          await roomMgr().destroyRoom(meta.room_id, null, 'auto');
          expired++;
        }
      }
    }
  } while (cursor !== '0');
  console.log(`[scheduler] restored ${restored} active room timers, ${expired} expired rooms destroyed`);

  // 启动周期性兜底检查
  startGuard();
}

module.exports = { register, cancel, restore, REMINDERS };
