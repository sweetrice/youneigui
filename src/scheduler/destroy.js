'use strict';

const { client } = require('../redis');
const roomManager = require('../room/manager');

/**
 * 销毁定时器 + 三级提醒
 *
 * 设计：用 setTimeout 做精确到秒的定时，destroy_at 到达时立即执行销毁。
 * 同时注册 3 个提醒定时器（1h / 10min / 1min 剩余时触发）。
 *
 * 如果服务器重启，从 Redis 里扫一遍所有 status=active 的 room 重建定时器。
 */

const timers = new Map(); // roomId -> { destroy, reminders: [] }

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

  const record = { destroy: null, reminders: [] };

  // 销毁定时器
  record.destroy = setTimeout(async () => {
    console.log(`[scheduler] auto-destroy trigger for ${roomId}`);
    await roomManager.destroyRoom(roomId, null, 'auto');
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
  const keys = await client.keys('room:meta:*');
  let restored = 0;
  for (const key of keys) {
    const meta = await client.hgetall(key);
    if (meta && meta.status === 'active' && meta.destroy_at) {
      const destroyAt = Number(meta.destroy_at);
      if (destroyAt > Date.now()) {
        await register(meta.room_id, destroyAt);
        restored++;
      } else {
        // 已过期但没销毁，直接销毁
        console.log(`[scheduler] found expired room ${meta.room_id}, destroying now`);
        await roomManager.destroyRoom(meta.room_id, null, 'auto');
      }
    }
  }
  console.log(`[scheduler] restored ${restored} active room timers`);
}

module.exports = { register, cancel, restore, REMINDERS };
