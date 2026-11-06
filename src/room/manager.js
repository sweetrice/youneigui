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
  // 房间码索引也必须设 TTL，否则会永远累积（唯一反向索引！）
  await client.expire(`room:code:${roomCode}`, destroySeconds + 3600);
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

  // 检查是否已加入——看 set 里有没有，同时补 hash（如果 hash 过期丢失了）
  // 不能只靠 hash key exists：因为 members set 的 TTL 会被后加入者刷新，
  // 但先加入者的 hash TTL 只设一次，可能先过期，导致 set 和 hash 不一致
  const inSet = await client.sismember(`room:${roomId}:members`, user.id);
  if (inSet) {
    // set 里有，但 hash 可能过期了，补写一下
    const hash = await client.hgetall(`room:${roomId}:member:${user.id}`);
    if (!hash || !hash.id) {
      await rewriteMemberHash(roomId, user);
    }
    return { room, isNewMember: false };
  }

  await addMember(roomId, user);
  return { room, isNewMember: true };
}

/**
 * 补写成员 hash（hash 过期但 set 里还有人的情况）
 */
async function rewriteMemberHash(roomId, user) {
  const now = Date.now();
  await client.hset(`room:${roomId}:member:${user.id}`, {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar || '',
    oauth_provider: user.oauthProvider || '',
    joined_at: String(now),
  });
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - now) / 1000) + 3600);
    await client.expire(`room:${roomId}:member:${user.id}`, ttl);
  }
  console.log(`[room] rewrote missing member hash ${user.id} in ${roomId}`);
}

async function addMember(roomId, user) {
  const now = Date.now();
  await client.sadd(`room:${roomId}:members`, user.id);
  // participants：累计进过房的所有人（leaveRoom 不移除），用于销毁时审计人数统计
  await client.sadd(`room:${roomId}:participants`, user.id);
  await client.hset(`room:${roomId}:member:${user.id}`, {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar || '',
    oauth_provider: user.oauthProvider || '',
    joined_at: String(now),
  });
  // 统一 TTL：成员 hash 和 members set 用相同的过期时间
  // 每次有人加入，刷新整个 members set + 所有人的 hash，确保不会出现 TTL 不一致
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - now) / 1000) + 3600);
    await client.expire(`room:${roomId}:member:${user.id}`, ttl);
    await client.expire(`room:${roomId}:members`, ttl);
    await client.expire(`room:${roomId}:participants`, ttl);
    // 同时刷新所有现有成员的 hash TTL，防止先加入者的 hash 先过期
    const existingIds = await client.smembers(`room:${roomId}:members`);
    if (existingIds.length > 1) {
      // 用 pipeline 批量 expire，性能可接受（每个房间不会有几十上百人）
      const multi = client.multi();
      for (const mid of existingIds) {
        multi.expire(`room:${roomId}:member:${mid}`, ttl);
      }
      await multi.exec();
    }
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
 * @param {string} roomId
 * @param {object} user { id, nickname, avatar }
 * @param {string} content 文字内容（type=text 时）
 * @param {object} [opts] 媒体消息选项
 * @param {'text'|'image'|'audio'|'video'|'document'} [opts.type='text']
 * @param {string} [opts.fileKey]   内部存储 key（清理用）
 * @param {string} [opts.publicUrl] 前端访问 URL（展示用）
 * @param {string} [opts.mime]
 * @param {number} [opts.size]
 */
async function sendMessage(roomId, user, content, opts) {
  const room = await getRoom(roomId);
  if (!room) throw new Error('room_not_found');
  if (room.status !== 'active') throw new Error('room_destroyed');

  // 刷屏速率限制：每用户每房间 N 秒内最多 M 条
  const floodKey = `flood:${roomId}:${user.id}`;
  const floodCount = await client.incr(floodKey);
  if (floodCount === 1) {
    await client.expire(floodKey, config.floodWindowSeconds);
  }
  if (floodCount > config.floodMaxPerWindow) {
    console.warn(`[message] flood blocked: user=${user.id} room=${roomId} count=${floodCount}`);
    throw Object.assign(new Error('flood_detected'), { detail: `发送过快，请 ${config.floodWindowSeconds} 秒后再试` });
  }

  const type = (opts && opts.type) || 'text';

  // 校验
  if (type === 'text') {
    const text = (content || '').trim();
    if (!text || text.length > config.maxMessageLength) throw new Error('message_invalid');
  } else if (['image', 'audio', 'video', 'document'].includes(type)) {
    // media 类型：必须有 publicUrl 和 fileKey
    if (!opts || !opts.publicUrl || !opts.fileKey) throw new Error('message_invalid');
    // 验证 fileKey 归属本房间（防前端伪造其他房间的文件）
    if (!opts.fileKey.startsWith(`rooms/${roomId}/`)) throw new Error('message_invalid');
    // 验证文件确实存在于磁盘
    const mediaStore = require('../media/store');
    if (!mediaStore.fileExists(opts.fileKey)) throw new Error('message_invalid');
  } else {
    throw new Error('message_invalid');
  }

  const now = Date.now();
  const msg = {
    id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: roomId,
    sender_id: user.id,
    sender_nickname: user.nickname,
    sender_avatar: user.avatar || '',
    type,           // 'text' | 'image' | 'audio' | 'video' | 'document'
    timestamp: now,
  };

  if (type === 'text') {
    msg.content = content.trim();
  } else {
    // media 消息：只存元数据 + 小 JSON，不存实际文件
    msg.content = '';           // media 消息 content 为空
    msg.file_key = opts.fileKey;
    msg.public_url = opts.publicUrl;
    msg.mime = opts.mime || '';
    msg.size = opts.size || 0;
    if (opts.originalName) msg.original_name = opts.originalName;
  }

  await client.rpush(`room:${roomId}:messages`, JSON.stringify(msg));
  // 超长 List 自动裁剪（只保留最近 N 条，Redis 存满也不怕）
  if (config.maxMessagesPerRoom > 0) {
    await client.ltrim(`room:${roomId}:messages`, -config.maxMessagesPerRoom, -1);
  }
  // 消息 TTL 跟随房间
  const meta = await client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - now) / 1000) + 3600);
    await client.expire(`room:${roomId}:messages`, ttl);
  }

  return msg;
}

/**
 * 撤回自己发的消息（广播给所有人，所有人都看不到）
 * @param {string} roomId
 * @param {object} actor 操作人 user 对象（只能撤自己的）
 * @param {string} msgId 消息 ID
 * @returns {object} { ok: true, wasMedia, revokedMessage }
 */
async function revokeMessage(roomId, actor, msgId) {
  // 1. 找到这条消息
  const rawList = await client.lrange(`room:${roomId}:messages`, 0, -1);
  let targetIndex = -1;
  let targetMsg = null;
  for (let i = 0; i < rawList.length; i++) {
    try {
      const m = JSON.parse(rawList[i]);
      if (m.id === msgId) { targetIndex = i; targetMsg = m; break; }
    } catch {}
  }
  if (targetIndex === -1) throw new Error('message_not_found');

  // 2. 权限：只有发件人能撤回
  if (targetMsg.sender_id !== actor.id) throw new Error('not_your_message');

  // 3. 不能撤回已撤回的
  if (targetMsg.type === 'revoked') throw new Error('message_already_revoked');

  // 4. 用 LSET 原位替换（O(1)，不破坏 List 顺序）
  const revokedMark = JSON.stringify({
    type: 'revoked',
    original_id: targetMsg.id,
    revoked_by: actor.id,
    revoked_at: Date.now(),
  });
  await client.lset(`room:${roomId}:messages`, targetIndex, revokedMark);

  // 5. 如果是媒体消息，同步删磁盘文件 + 扣减计数器
  let wasMedia = false;
  if (['image', 'audio', 'video', 'document'].includes(targetMsg.type) && targetMsg.file_key) {
    wasMedia = true;
    const mediaStore = require('../media/store');
    mediaStore.deleteFile(targetMsg.file_key);
    // 扣减计数器
    if (targetMsg.size) {
      await client.decrby(`room:${roomId}:media_bytes`, targetMsg.size);
      // 防止变负数（理论上不会，但计数器可能不同步）
      await client.eval(
        "local v = tonumber(redis.call('get', KEYS[1]) or '0'); if v < 0 then redis.call('set', KEYS[1], '0') end",
        1, `room:${roomId}:media_bytes`
      );
    }
  }

  return { ok: true, wasMedia, revokedMessage: targetMsg };
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

  // 写入审计日志（用 ZSET，score=destroy_at，天然支持元素级过期清理）
  // 注意：不用 List + EXPIRE——因为每次 LPUSH 会刷新整个 List 的 TTL，导致永远不过期
  // 审计人数统计：优先用 participants（累计进过房的人，不受中途退出影响），
  // 旧房间没有 participants key 时回退 members（当前在线），再回退内存数据
  const memberCount = await client.scard(`room:${roomId}:participants`)
    || await client.scard(`room:${roomId}:members`)
    || room.members.length;
  const msgCount = room.messages.length;
  const auditEntry = JSON.stringify({
    room_id: roomId,
    destroy_at: Date.now(),
    destroy_trigger: triggerType, // 'manual' | 'auto'
    destroy_actor_role: actor ? (actor.id === room.creatorId ? 'creator' : 'member') : 'system',
    member_count: memberCount,
    message_count: msgCount,
    topic_length: room.topic.length,
  });
  // ZADD score=destroy_at(时间戳)，member=JSON
  // stats 接口会用 ZREMRANGEBYSCORE 清理 90 天前的过期项，不设全局 EXPIRE
  await client.zadd('audit:rooms', Date.now(), auditEntry);

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

  // 清理媒体文件
  try {
    const mediaStore = require('../media/store');
    mediaStore.cleanupRoom(roomId);
  } catch (e) {
    console.error(`[room] cleanup media for ${roomId} failed:`, e.message);
  }

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
  revokeMessage,
};
