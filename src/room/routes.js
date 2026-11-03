'use strict';

const router = require('express').Router();
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const room = require('../room/manager');

// GET /api/rooms/presets — 返回预设销毁时间
router.get('/presets', (req, res) => {
  res.json({
    presets: config.destroyPresets,
    minSeconds: config.destroyMin,
    maxSeconds: config.destroyMax,
    codeChars: config.codeChars,
    codeLength: config.codeLength,
  });
});

// POST /api/rooms — 创建会话
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { topic, destroySeconds } = req.body;
    const result = await room.createRoom(user, {
      topic,
      destroySeconds: parseInt(destroySeconds, 10),
    });
    res.json({ ok: true, room: result });
  } catch (e) {
    console.error('[api/rooms] create error:', e.message);
    const map = {
      topic_invalid: [400, '主题不能为空且不超过 50 字'],
      destroy_time_invalid: [400, '销毁时间需在 10 分钟至 30 天之间'],
      room_code_collision: [500, '生成房间码失败，请重试'],
    };
    const [code, msg] = map[e.message] || [500, 'server_error'];
    res.status(code).json({ ok: false, error: e.message, message: msg });
  }
});

// GET /api/rooms/by-code/:code — 通过房间码查找
router.get('/by-code/:code', async (req, res) => {
  const r = await room.findByCode(req.params.code.toUpperCase());
  if (!r) return res.status(404).json({ ok: false, error: 'room_not_found_or_destroyed' });
  // 返回基础信息，具体内容需要加入后才能看
  res.json({
    ok: true,
    roomId: r.roomId,
    roomCode: r.roomCode,
    topic: r.topic,
    creatorNickname: r.creatorNickname,
    creatorAvatar: r.creatorAvatar,
    status: r.status,
    remainingSeconds: r.remainingSeconds,
  });
});

// POST /api/rooms/:roomId/join — 加入会话
router.post('/:roomId/join', requireAuth, async (req, res) => {
  try {
    const result = await room.joinRoom(req.params.roomId, req.user);
    // 返回完整房间信息
    const fullRoom = await room.getRoom(req.params.roomId);
    res.json({ ok: true, room: fullRoom, isNewMember: result.isNewMember });
  } catch (e) {
    console.error('[api/rooms] join error:', e.message);
    const map = {
      room_not_found_or_destroyed: [404, '会话不存在或已销毁'],
      room_destroyed: [410, '会话已销毁'],
    };
    const [code, msg] = map[e.message] || [500, 'server_error'];
    res.status(code).json({ ok: false, error: e.message, message: msg });
  }
});

// GET /api/rooms/:roomId — 获取完整房间信息（需登录）
router.get('/:roomId', requireAuth, async (req, res) => {
  const r = await room.getRoom(req.params.roomId);
  if (!r) return res.status(404).json({ ok: false, error: 'room_not_found' });
  res.json({ ok: true, room: r });
});

// POST /api/rooms/:roomId/leave — 退出会话（自己走，不销毁）
router.post('/:roomId/leave', requireAuth, async (req, res) => {
  await room.leaveRoom(req.params.roomId, req.user.id);
  // 通知其他成员
  const { client } = require('../redis');
  await client.publish('room:event', JSON.stringify({
    type: 'member_left',
    room_id: req.params.roomId,
    member: req.user,
  }));
  res.json({ ok: true });
});

// POST /api/rooms/:roomId/destroy — 结束会话（任何人平等销毁）
router.post('/:roomId/destroy', requireAuth, async (req, res) => {
  try {
    const result = await room.destroyRoom(req.params.roomId, req.user, 'manual');
    res.json({ ok: true, room: result });
  } catch (e) {
    console.error('[api/rooms] destroy error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/rooms/:roomId/destroy-time — 创建者编辑销毁时间
router.put('/:roomId/destroy-time', requireAuth, async (req, res) => {
  try {
    const result = await room.editDestroyTime(
      req.params.roomId,
      req.user.id,
      req.body.destroySeconds,
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    const map = {
      room_not_found: [404, '会话不存在'],
      not_creator: [403, '只有创建者可以编辑销毁时间'],
      room_destroyed: [410, '会话已销毁'],
      destroy_time_invalid: [400, '销毁时间需在 10 分钟至 30 天之间'],
    };
    const [code, msg] = map[e.message] || [500, 'server_error'];
    res.status(code).json({ ok: false, error: e.message, message: msg });
  }
});

module.exports = router;
