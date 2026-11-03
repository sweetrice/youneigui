'use strict';

const { client, destroyRoomKeys } = require('../redis');
const config = require('../config');
const { generateRoomCode, generateRoomId } = require('../utils/codegen');
const schedule = require('../scheduler/destroy');

/**
 * 创建会话
 * @param {object} creator 创建者 user 对象 { id, nickname, avatar, oauthProvider }
 * @param {object} data { topic, destroySeconds }
 */
async function createRoom(creator, data) {
  const topic = (data.topic || '').trim();
  if (!topic || topic.length > 50) {
    throw new Error('topic_invalid');
  }
  const destroySeconds = parseInt(data.destroySeconds, 10);
  if (!Number.isFinite(destroySeconds) ||
      destroySeconds < config.destroyMin ||
      destroySeconds > config.destroyMax) {
    throw new Error('destroy_time_invalid');
  }

  // 生成不重复的房间码（最多重试 3 次）
  let roomCode;
  let roomId;
  for (let i = 0; i < 3; i++) {
    roomCode = generateRoomCode();
    const exists = await client.exists(`room:code:${roomCode}`);
    if (!exists) {
      roomId = generateRoomId();
      break;
    }
  }
  if (!roomId) throw new Error('room_code_collision');

  const now = Date.now();
  const destroyAt = now + destroySeconds * 1000;

  // 存储房间元数据（使用 Redis Hash）
  await client.hset(`room:meta:${roomId}`, {
    room_id: roomId,
    room_code: roomCode,
    topic,
    creator_id: creator.id,
    creator_nickname: creator.nickname,
    creator_avatar: creator.avatar || '',
    created_at: String(now),
    destroy_at: String(destroyAt),
    destroy_seconds: String(destroySeconds),
    status: 'active',
  });
  // 房间码 -> room_id 反向索引
  await client.set(`room:code:${roomCode}`, roomId);
  // 设置整个 key 的 TTL（兜底，即使销毁定时器挂了也会自动清）
  await client.expire(`room:meta:${roomId}`, destroySeconds + 3600); // 多 1h 缓冲

  // 加入创建者为第一个成员
  await addMember(roomId, creator);

  // 注册销毁定时器
  await schedule.register(roomId, destroyAt);

  console.log(`[room] created ${roomId} (code=${roomCode}, topic="${topic}", destroyAt=${new Date(destroyAt).toISOString()})`);

  return {
    roomId,
    roomCode,
    topic,
    destroyAt,
    destroySeconds,
    creator,
  };
}

/**
 * 通过房间码查找会话
 */
async function findByCode(roomCode) {
  const roomId = await client.get(`room:code:${roomCode.toUpperCase()}`);
  if (!roomId) return null;
  return getRoom(roomId);
}

/**
 * 获取会话完整信息
 */
async function getRoom(roomId) {
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (!meta || !meta.room_id || meta.status === 'destroyed') return null;

  // 获取成员列表
  const memberIds = await client.smembers(`room:${roomId}:members`);
  const members = [];
  for (const mid of memberIds) {
    const member = await client.hgetall(`room:${roomId}:member:${mid}`);
    if (member && member.id) members.push(member);
  }
  // 按加入时间排序
  members.sort((a, b) => Number(a.joined_at) - Number(b.joined_at));

  // 消息列表（最多 200 条最新）
  const messages = await client.lrange(`room:${roomId}:messages`, -200, -1);
  const parsedMessages = messages.map(m => JSON.parse(m));

  return {
    roomId: meta.room_id,
    roomCode: meta.room_code,
    topic: meta.topic,
    creatorId: meta.creator_id,
    creatorNickname: meta.creator_nickname,
    creatorAvatar: meta.creator_avatar,
    createdAt: Number(meta.created_at),
    destroyAt: Number(meta.destroy_at),
    destroySeconds: Number(meta.destroy_seconds),
    status: meta.status,
    members,
    messages: parsedMessages,
    remainingSeconds: Math.max(0, Math.floor((Number(meta.destroy_at) - Date.now()) / 1000)),
  };
}

/**
 * 加入会话
 */
async function joinRoom(roomId, user) {
  const room = await getRoom(roomId);
  if (!room) throw new Error('room_not_found_or_destroyed');
  if (room.status !== 'active') throw new Error('room_destroyed');

  // 检查是否已加入
  const already = await client.exists(`room:${roomId}:member:${user.id}`);
  if (already) return { room, isNewMember: false };

  await addMember(roomId, user);
  return { room, isNewMember: true };
}

async function addMember(roomId, user) {
  const now = Date.now();
  await client.sadd(`room:${roomId}:members`, user.id);
  await client.hset(`room:${roomId}:member:${user.id}`, {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar || '',
    oauth_provider: user.oauthProvider || '',
    joined_at: String(now),
  });
  // 成员 key TTL 跟随房间
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - now) / 1000) + 3600);
    await client.expire(`room:${roomId}:member:${user.id}`, ttl);
    await client.expire(`room:${roomId}:members`, ttl);
  }
}

/**
 * 成员退出会话（自己走，会话继续）
 */
async function leaveRoom(roomId, userId) {
  await client.srem(`room:${roomId}:members`, userId);
  await client.del(`room:${roomId}:member:${userId}`);
  console.log(`[room] member ${userId} left room ${roomId}`);
}

/**
 * 发送消息（存 Redis + 返回完整消息对象）
 */
async function sendMessage(roomId, user, content) {
  const room = await getRoom(roomId);
  if (!room) throw new Error('room_not_found');
  if (room.status !== 'active') throw new Error('room_destroyed');
  const text = (content || '').trim();
  if (!text || text.length > 2000) throw new Error('message_invalid');

  const now = Date.now();
  const msg = {
    id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: roomId,
    sender_id: user.id,
    sender_nickname: user.nickname,
    sender_avatar: user.avatar || '',
    content: text,
    timestamp: now,
  };

  await client.rpush(`room:${roomId}:messages`, JSON.stringify(msg));
  // 消息 TTL 跟随房间
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - now) / 1000) + 3600);
    await client.expire(`room:${roomId}:messages`, ttl);
  }

  return msg;
}

/**
 * 结束会话（任何人触发立即销毁）
 * @param {string} roomId
 * @param {object} actor 操作人 user 对象
 * @param {'manual'|'auto'} triggerType
 */
async function destroyRoom(roomId, actor, triggerType = 'manual') {
  const room = await getRoom(roomId);
  if (!room) return null;
  if (room.status === 'destroyed') return null;

  // 标记为已销毁
  await client.hset(`room:meta:${roomId}`, 'status', 'destroyed');
  await client.persist(`room:meta:${roomId}`); // 先取消原有 TTL
  await client.expire(`room:meta:${roomId}`, 7 * 24 * 60 * 60); // 审计日志保留 7 天

  // 写入审计日志
  const memberCount = room.members.length;
  const msgCount = room.messages.length;
  await client.lpush('audit:rooms', JSON.stringify({
    room_id: roomId,
    destroy_at: Date.now(),
    destroy_trigger: triggerType, // 'manual' | 'auto'
    destroy_actor_role: actor ? (actor.id === room.creatorId ? 'creator' : 'member') : 'system',
    member_count: memberCount,
    message_count: msgCount,
    topic_length: room.topic.length,
  }));
  await client.expire('audit:rooms', 90 * 24 * 60 * 60); // 审计日志保留 90 天

  // 写销毁通知（通过 Redis Pub/Sub 通知 WebSocket 层）
  await client.publish('room:destroyed', JSON.stringify({
    room_id: roomId,
    trigger: triggerType,
    actor_nickname: actor ? actor.nickname : null,
    timestamp: Date.now(),
  }));

  // 清销毁定时器
  await schedule.cancel(roomId);

  // 数据永久销毁（消息、成员），元数据保留做审计
  await destroyRoomKeys(roomId);

  console.log(`[room] destroyed ${roomId} (trigger=${triggerType}, actor=${actor ? actor.id : 'system'}, members=${memberCount}, msgs=${msgCount})`);

  return room;
}

/**
 * 创建者编辑销毁时间（延长/缩短，不能取消销毁）
 */
async function editDestroyTime(roomId, creatorId, newDestroySeconds) {
  const room = await getRoom(roomId);
  if (!room) throw new Error('room_not_found');
  if (room.creatorId !== creatorId) throw new Error('not_creator');
  if (room.status !== 'active') throw new Error('room_destroyed');
  const secs = parseInt(newDestroySeconds, 10);
  if (!Number.isFinite(secs) || secs < config.destroyMin || secs > config.destroyMax) {
    throw new Error('destroy_time_invalid');
  }

  const now = Date.now();
  const newDestroyAt = now + secs * 1000;

  await client.hset(`room:meta:${roomId}`, {
    destroy_at: String(newDestroyAt),
    destroy_seconds: String(secs),
  });
  await client.expire(`room:meta:${roomId}`, secs + 3600);

  // 重新注册销毁定时器
  await schedule.register(roomId, newDestroyAt);

  // 通知所有成员
  await client.publish('room:event', JSON.stringify({
    type: 'destroy_time_updated',
    room_id: roomId,
    new_destroy_at: newDestroyAt,
  }));

  return { destroyAt: newDestroyAt };
}

module.exports = {
  createRoom,
  findByCode,
  getRoom,
  joinRoom,
  leaveRoom,
  sendMessage,
  destroyRoom,
  editDestroyTime,
};
