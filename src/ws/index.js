'use strict';

const { WebSocketServer } = require('ws');
const room = require('../room/manager');
const config = require('../config');

/**
 * WebSocket 连接管理
 *
 * 架构：
 * - 每个 WS 连接绑定一个 roomId（通过 URL 参数传入）
 * - 服务端维护 roomId -> Set<WebSocket> 的映射
 * - 消息分两类：chat（普通聊天）、event（系统事件，如销毁/加入/退出）
 * - 销毁事件通过 Redis Pub/Sub 广播，所有 WS server 实例都能收到（支持水平扩展）
 */

const rooms = new Map(); // roomId -> Set<ws>

function createWebSocketServer(http, redis) {
  const wss = new WebSocketServer({ server: http, path: '/ws' });

  // ========== Redis Pub/Sub 监听 ==========
  const sub = redis.duplicate();
  sub.subscribe('room:event', 'room:destroyed');
  sub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === 'room:destroyed') {
        // 销毁事件：通知房间内所有人，然后关闭连接
        broadcast(data.room_id, {
          type: 'room_destroyed',
          trigger: data.trigger,
          actorNickname: data.actor_nickname,
          timestamp: data.timestamp,
        });
        // 延迟关闭连接（让前端先收到销毁消息）
        setTimeout(() => closeRoomConnections(data.room_id), 500);
      } else if (channel === 'room:event') {
        // 普通事件（加入/退出/销毁时间更新/提醒）
        broadcast(data.room_id, data);
      }
    } catch (e) {
      console.error('[ws] pub/sub parse error:', e);
    }
  });

  // ========== WS 连接处理 ==========
  wss.on('connection', async (ws, req) => {
    try {
      // 从 URL query 里取 roomId
      const url = new URL(req.url, `http://${req.headers.host}`);
      const roomId = url.searchParams.get('roomId');
      // sid 可选（用于日志追踪），不强制要求
      const sessionId = url.searchParams.get('sid');

      if (!roomId) {
        ws.close(4400, 'missing_roomId');
        return;
      }

      // 验证 session（简单方式：用 express-session 的 store）
      // 我们不在这里直接查 session，而是在消息里等客户端发 hello
      ws.roomId = roomId;
      ws.userId = null; // 等 hello 消息后设置
      ws.isAlive = true;

      // 注册到房间
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(ws);

      // 发 ping 保活
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', async (raw) => {
        let data;
        try {
          data = JSON.parse(raw.toString());
        } catch { return; }

        switch (data.type) {
          case 'hello':
            // 客户端连接后先发送 hello，携带用户信息
            ws.userId = data.userId;
            ws.nickname = data.nickname;
            ws.avatar = data.avatar;
            send(ws, { type: 'connected', roomId });
            break;

          case 'chat':
            await handleChat(ws, roomId, data);
            break;

          case 'pong':
            break; // 忽略

          default:
            // 未知类型忽略
        }
      });

      ws.on('close', () => {
        if (ws.roomId && rooms.has(ws.roomId)) {
          rooms.get(ws.roomId).delete(ws);
          if (rooms.get(ws.roomId).size === 0) {
            rooms.delete(ws.roomId);
          }
        }
      });

      ws.on('error', (err) => {
        console.error(`[ws] error room=${roomId}:`, err.message);
      });

    } catch (e) {
      console.error('[ws] connection error:', e);
      ws.close();
    }
  });

  // 定时 ping 保活（30 秒）
  const pingInterval = setInterval(() => {
    for (const [, conns] of rooms) {
      for (const ws of conns) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
    }
  }, 30000);

  wss.on('close', () => clearInterval(pingInterval));
}

async function handleChat(ws, roomId, data) {
  if (!ws.userId) return; // 还没 hello
  try {
    const msg = await room.sendMessage(roomId, {
      id: ws.userId,
      nickname: ws.nickname,
      avatar: ws.avatar,
    }, data.content);
    broadcast(roomId, { type: 'chat', message: msg });
  } catch (e) {
    if (e.message === 'room_destroyed') {
      send(ws, { type: 'error', error: 'room_destroyed' });
    } else if (e.message === 'message_invalid') {
      send(ws, { type: 'error', error: 'message_invalid', detail: '消息不能为空或超过 2000 字' });
    } else {
      console.error('[ws] chat error:', e.message);
    }
  }
}

function broadcast(roomId, data) {
  const conns = rooms.get(roomId);
  if (!conns) return;
  const payload = JSON.stringify(data);
  for (const ws of conns) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(payload); } catch {}
    }
  }
}

function send(ws, data) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }
}

function closeRoomConnections(roomId) {
  const conns = rooms.get(roomId);
  if (!conns) return;
  for (const ws of conns) {
    try { ws.close(4410, 'room_destroyed'); } catch {}
  }
  rooms.delete(roomId);
}

module.exports = { createWebSocketServer };
