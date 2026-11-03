'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const room = require('../room/manager');

// GET /api/export/:roomId — 导出 Markdown
router.get('/:roomId', requireAuth, async (req, res) => {
  const roomData = await room.getRoom(req.params.roomId);
  if (!roomData) {
    return res.status(404).send('会话不存在或已销毁');
  }
  if (roomData.status !== 'active') {
    return res.status(410).send('会话已销毁，无法导出');
  }

  // 生成 Markdown
  const now = new Date();
  const fmt = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { hour12: false });
  };

  const lines = [];
  lines.push(`# 临时会话：${roomData.topic}`);
  lines.push('');
  lines.push(`- 创建者：${roomData.creatorNickname}`);
  lines.push(`- 创建时间：${fmt(roomData.createdAt)}`);
  lines.push(`- 销毁时间：${fmt(roomData.destroyAt)}（剩余 ${roomData.remainingSeconds} 秒）`);
  lines.push(`- 成员：${roomData.members.map(m => m.nickname).join('、')}`);
  lines.push(`- 消息数：${roomData.messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 会话记录');

  // 按日期分组
  const groups = {};
  for (const msg of roomData.messages) {
    const dateKey = new Date(msg.timestamp).toLocaleDateString('zh-CN');
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(msg);
  }

  for (const [dateKey, msgs] of Object.entries(groups)) {
    lines.push('');
    lines.push(`### ${dateKey}`);
    for (const msg of msgs) {
      const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
      lines.push('');
      lines.push(`**${msg.sender_nickname}** @ ${time}：`);
      // 消息内容可能有多行，逐行加上 >
      for (const line of msg.content.split('\n')) {
        lines.push(`> ${line}`);
      }
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> 本会话由「有内鬼」生成，已导出后内容与线上会话无关');
  lines.push(`> 导出时间：${fmt(now.getTime())}`);

  const md = lines.join('\n');

  // 文件名（过滤非法字符）
  const safeTopic = roomData.topic.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  const filename = `${safeTopic}_${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(md);
});

module.exports = router;
