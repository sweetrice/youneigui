'use strict';

/**
 * 本地媒体文件存储（替代 MinIO，零外部依赖）
 *
 * 存储结构：
 *   ${storageRoot}/rooms/${roomId}/${type}/${timestamp}_${random}.${ext}
 *
 * 安全边界：
 *   - 仅允许白名单 MIME 类型
 *   - 单文件大小上限（按类型）
 *   - 单房间总大小上限（超过则拒绝上传）
 *   - 文件实际存储路径不暴露给前端，前端拿到的是 /media/rooms/xxx 公开 URL
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const redis = require('../redis');
const config = require('../config');

// 白名单 MIME + 单文件大小上限
const MIME_LIMITS = {
  'image/jpeg':   { maxBytes: 5 * 1024 * 1024,    ext: '.jpg',  type: 'image' },
  'image/png':    { maxBytes: 5 * 1024 * 1024,    ext: '.png',  type: 'image' },
  'image/webp':   { maxBytes: 5 * 1024 * 1024,    ext: '.webp', type: 'image' },
  'audio/mpeg':   { maxBytes: 20 * 1024 * 1024,   ext: '.mp3',  type: 'audio' },
  'audio/wav':    { maxBytes: 20 * 1024 * 1024,   ext: '.wav',  type: 'audio' },
  'video/mp4':    { maxBytes: 50 * 1024 * 1024,   ext: '.mp4',  type: 'video' },
  // 文档类（按扩展名识别，MIME 可能是空或 application/octet-stream）
  'application/pdf':       { maxBytes: 20 * 1024 * 1024, ext: '.pdf',  type: 'document' },
  'application/msword':    { maxBytes: 20 * 1024 * 1024, ext: '.doc',  type: 'document' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { maxBytes: 20 * 1024 * 1024, ext: '.docx', type: 'document' },
  'application/vnd.ms-excel': { maxBytes: 20 * 1024 * 1024, ext: '.xls', type: 'document' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { maxBytes: 20 * 1024 * 1024, ext: '.xlsx', type: 'document' },
  'application/vnd.ms-powerpoint': { maxBytes: 20 * 1024 * 1024, ext: '.ppt', type: 'document' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { maxBytes: 20 * 1024 * 1024, ext: '.pptx', type: 'document' },
  'application/json':   { maxBytes: 20 * 1024 * 1024, ext: '.json', type: 'document' },
  'text/plain':         { maxBytes: 20 * 1024 * 1024, ext: '.txt',  type: 'document' },
  'text/markdown':      { maxBytes: 20 * 1024 * 1024, ext: '.md',   type: 'document' },
  'text/csv':           { maxBytes: 20 * 1024 * 1024, ext: '.csv',  type: 'document' },
};

// 扩展名兜底（MIME 为空或 application/octet-stream 时用）
const EXT_LIMITS = {
  '.txt':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.md':   { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.pdf':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.doc':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.docx': { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.xls':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.xlsx': { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.ppt':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.pptx': { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.json': { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.csv':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
  '.zip':  { maxBytes: 20 * 1024 * 1024, type: 'document' },
};

const PUBLIC_BASE = '/media/rooms'; // express.static 挂载路径

/**
 * 生成唯一文件名（不暴露原始文件名，防路径遍历）
 */
function generateFileId() {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  return `${ts}_${rand}`;
}

/**
 * 校验 MIME 类型和大小
 */
function validateFile(mime, size, originalname) {
  // 1. 先按 MIME 精确匹配
  let rule = MIME_LIMITS[mime];
  let ext = rule ? rule.ext : null;

  // 2. MIME 没匹配到 → 从原始文件名取扩展名兜底（文档类常用）
  if (!rule && originalname) {
    const nameExt = path.extname(originalname).toLowerCase();
    const extRule = EXT_LIMITS[nameExt];
    if (extRule) {
      rule = { maxBytes: extRule.maxBytes, ext: nameExt, type: extRule.type };
      ext = nameExt;
    }
  }

  if (!rule) return { ok: false, error: 'type_not_allowed', detail: `不支持的文件类型: ${mime || '(未知)'}` };
  if (size > rule.maxBytes) {
    return { ok: false, error: 'too_large', detail: `最大 ${rule.maxBytes / 1024 / 1024}MB，当前 ${(size / 1024 / 1024).toFixed(1)}MB` };
  }
  return { ok: true, rule };
}

/**
 * 获取当前房间已用媒体字节数
 */
async function getRoomMediaBytes(roomId) {
  const bytes = await redis.client.get(`room:${roomId}:media_bytes`);
  return parseInt(bytes || '0', 10);
}

/**
 * 检查是否超限
 */
async function checkRoomQuota(roomId, incomingSize) {
  const used = await getRoomMediaBytes(roomId);
  const max = config.mediaMaxRoomBytes;
  if (used + incomingSize > max) {
    return { ok: false, used, max };
  }
  return { ok: true, used, remaining: max - used - incomingSize };
}

/**
 * 上传媒体文件
 * @param {string} roomId 房间 ID
 * @param {object} file { path, originalname, mimetype, size } 来自 multer
 * @returns {object} { fileKey, publicUrl, mime, size, type }
 */
async function upload(roomId, file) {
  const { mimetype: mime, size, path: tmpPath } = file;

  // 修复 multer 中文文件名乱码：busboy 把浏览器发的 UTF-8 字节当成 latin1 解释
  // 用 Buffer.from(str, 'latin1') 取回原始字节，再按 utf8 解码
  const rawName = file.originalname || '';
  const fixedName = rawName ? Buffer.from(rawName, 'latin1').toString('utf8') : rawName;
  if (fixedName) file.originalname = fixedName;

  // 1. MIME + 大小校验
  const v = validateFile(mime, size, fixedName);
  if (!v.ok) throw Object.assign(new Error(v.error), { detail: v.detail });

  // 2. 房间限额校验
  const quota = await checkRoomQuota(roomId, size);
  if (!quota.ok) {
    // 清理临时文件
    try { fs.unlinkSync(tmpPath); } catch {}
    throw Object.assign(new Error('room_quota_exceeded'), {
      detail: `房间媒体配额 ${quota.max / 1024 / 1024}MB 已用 ${(quota.used / 1024 / 1024).toFixed(1)}MB，无法再上传 ${(size / 1024 / 1024).toFixed(1)}MB`,
    });
  }

  // 3. 目标路径
  const fileId = generateFileId();
  const storageDir = path.join(config.mediaStorageRoot, 'rooms', roomId, v.rule.type);
  const destPath = path.join(storageDir, `${fileId}${v.rule.ext}`);
  const fileKey = `rooms/${roomId}/${v.rule.type}/${fileId}${v.rule.ext}`;
  const publicUrl = `${PUBLIC_BASE}/${roomId}/${v.rule.type}/${fileId}${v.rule.ext}`;

  // 4. 创建目录 + 移动文件
  fs.mkdirSync(storageDir, { recursive: true });
  try {
    fs.renameSync(tmpPath, destPath);
  } catch (e) {
    // 跨设备 rename 失败时 fallback 到 copy + unlink
    fs.copyFileSync(tmpPath, destPath);
    try { fs.unlinkSync(tmpPath); } catch {}
  }

  // 4.5 视频转码：HEVC/H.265 → H.264（浏览器兼容）
  // 仅视频类型，其他类型跳过。ffmpeg 不可用时也跳过（降级）
  let finalSize = size;
  let transcoded = false;
  if (v.rule.type === 'video') {
    const transcode = require('./transcode');
    if (transcode.isAvailable()) {
      const result = await transcode.transcodeIfNeeded(destPath, destPath);
      if (result.ok && result.transcoded) {
        transcoded = true;
        finalSize = fs.statSync(result.outputPath).size;
        console.log(`[media] transcoded: ${(size/1024/1024).toFixed(1)}MB → ${(finalSize/1024/1024).toFixed(1)}MB`);
      }
    } else {
      console.warn('[media] ffmpeg not available, skipping HEVC transcode');
    }
  }

  // 5. 更新 Redis 计数器（如果转码了用新 size）
  await redis.client.incrby(`room:${roomId}:media_bytes`, finalSize);

  // 6. 如果房间 TTL 还有效，给 media_bytes 也设相同 TTL
  const meta = await redis.client.hgetall(`room:meta:${roomId}`);
  if (meta.destroy_at) {
    const ttl = Math.max(60, Math.floor((Number(meta.destroy_at) - Date.now()) / 1000) + 3600);
    await redis.client.expire(`room:${roomId}:media_bytes`, ttl);
  }

  return {
    fileKey,      // 内部存储 key，用于清理
    publicUrl,    // 前端可直接访问的 URL
    mime,
    size: finalSize,
    type: v.rule.type,
    transcoded,
    originalName: file.originalname, // 原始文件名（前端展示用）
  };
}

/**
 * 验证 fileKey 确实在磁盘上（防止前端伪造）
 */
function fileExists(fileKey) {
  const fullPath = path.join(config.mediaStorageRoot, fileKey);
  // 安全：确保路径在 storageRoot 内（防 ../ 遍历）
  const realRoot = fs.realpathSync(config.mediaStorageRoot);
  const realFile = fs.realpathSync(path.dirname(fullPath));
  if (!realFile.startsWith(realRoot)) return false;
  return fs.existsSync(fullPath);
}

/**
 * 销毁房间时清理整个媒体目录
 */
function cleanupRoom(roomId) {
  const roomDir = path.join(config.mediaStorageRoot, 'rooms', roomId);
  try {
    if (fs.existsSync(roomDir)) {
      fs.rmSync(roomDir, { recursive: true, force: true });
      console.log(`[media] cleaned room directory: ${roomDir}`);
    }
  } catch (e) {
    console.error(`[media] cleanupRoom error:`, e.message);
  }
}

/**
 * 删除单个媒体文件（撤回消息时调用）
 * @param {string} fileKey 形如 rooms/xxx/img/yyy.jpg
 */
function deleteFile(fileKey) {
  if (!fileKey || !fileKey.startsWith('rooms/')) return false;
  const fullPath = path.join(config.mediaStorageRoot, fileKey);
  // 安全：必须在 storageRoot 下
  if (!fullPath.startsWith(fs.realpathSync(config.mediaStorageRoot))) return false;
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`[media] deleted file: ${fileKey}`);
      return true;
    }
  } catch (e) {
    console.error(`[media] deleteFile error:`, e.message);
  }
  return false;
}

module.exports = {
  upload,
  cleanupRoom,
  deleteFile,
  fileExists,
  validateFile,
  MIME_LIMITS,
  PUBLIC_BASE,
};
