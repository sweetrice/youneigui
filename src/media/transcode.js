/**
 * 视频转码：检测编码，HEVC/H.265 → H.264
 * 
 * 为什么需要？
 * 微信默认用 HEVC 编码省空间（比 H.264 小 50%），但浏览器只支持 H.264 解码
 * 电脑播放器（VLC/系统播放器）有 HEVC 插件所以能播，浏览器不行
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// 检测系统 ffmpeg/ffprobe 是否可用
let _ffmpegPath = null;
let _ffprobePath = null;

function findBin(name) {
  // 先看 PATH（用 where.exe 避免 PowerShell 别名干扰）
  try {
    const which = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = require('child_process').execSync(`${which} ${name}`, { encoding: 'utf8', timeout: 3000, env: process.env });
    const path = result.trim().split('\n')[0].trim();
    if (path) return path;
  } catch {}

  // Windows winget 安装路径（递归找 bin 目录，因为中间可能有版本号目录）
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
      if (fs.existsSync(wingetDir)) {
        const dirs = fs.readdirSync(wingetDir).filter(d => d.toLowerCase().includes('ffmpeg'));
        for (const dir of dirs) {
          // 递归找所有 bin/${name}.exe
          const searchRoot = path.join(wingetDir, dir);
          const findRecursive = (root) => {
            let found = null;
            try {
              for (const sub of fs.readdirSync(root)) {
                const subPath = path.join(root, sub);
                const stat = fs.statSync(subPath);
                if (stat.isDirectory()) {
                  found = findRecursive(subPath);
                  if (found) break;
                } else if (stat.isFile() && sub === `${name}.exe`) {
                  found = subPath; break;
                }
              }
            } catch {}
            return found;
          };
          const found = findRecursive(searchRoot);
          if (found) return found;
        }
      }
    } catch {}
    // winget Links 目录
    const links = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', `${name}.exe`);
    if (fs.existsSync(links)) return links;
  }

  // Linux/macOS 常见位置
  const unixCandidates = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const c of unixCandidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
}

function ensureBins() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  _ffmpegPath = findBin('ffmpeg') || 'ffmpeg';
  _ffprobePath = findBin('ffprobe') || 'ffprobe';
  return _ffmpegPath;
}

/**
 * 检测视频编码
 * @param {string} filePath 本地文件路径
 * @returns {Promise<string|null>} 视频编码名称，如 'h264' / 'hevc' / null（检测失败或无视频轨）
 */
async function detectVideoCodec(filePath) {
  ensureBins();
  return new Promise((resolve) => {
    execFile(_ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        console.warn(`[transcode] ffprobe failed:`, err.message);
        return resolve(null);
      }
      const codec = (stdout || '').trim();
      console.log(`[transcode] detected video codec: ${codec || '(none)'}`);
      resolve(codec || null);
    });
  });
}

/**
 * 转码：HEVC/H.265 → H.264（浏览器兼容）
 * 其他编码不动，原文件直接返回
 * 
 * @param {string} inputPath 原文件路径
 * @param {string} outputPath 输出文件路径（同目录，覆盖原文件）
 * @returns {Promise<{ ok: boolean, transcoded: boolean, outputPath: string, error?: string }>}
 */
async function transcodeIfNeeded(inputPath, outputPath) {
  ensureBins();

  // 检测编码
  const codec = await detectVideoCodec(inputPath);

  // 已经是 H.264 或无法检测 → 不动
  if (codec === null) {
    console.log('[transcode] cannot detect codec, keeping original');
    return { ok: true, transcoded: false, outputPath: inputPath };
  }
  if (codec === 'h264' || codec === 'avc1' || codec === 'avc') {
    console.log('[transcode] already H.264, keeping original');
    return { ok: true, transcoded: false, outputPath: inputPath };
  }

  // 需要转码（HEVC / VP9 / AV1 等非 H.264）
  console.log(`[transcode] ${codec} → H.264 transcoding...`);
  return new Promise((resolve) => {
    const tmpPath = outputPath + '.transcoding.mp4';
    execFile(_ffmpegPath, [
      '-y',                          // 覆盖输出
      '-i', inputPath,               // 输入
      '-c:v', 'libx264',             // 视频编码 H.264
      '-preset', 'fast',             // 速度优先（fast ≈ 压缩率/速度 平衡）
      '-crf', '23',                  // 画质（18 极好，28 较差，23 默认）
      '-c:a', 'aac',                 // 音频编码 AAC（浏览器兼容）
      '-b:a', '128k',                // 音频比特率
      '-movflags', '+faststart',     // ✅ 关键！把 moov atom 移到文件头（浏览器在线播放必需）
      tmpPath,
    ], { timeout: 300000 }, (err) => {  // 5 分钟超时
      if (err) {
        console.error(`[transcode] ffmpeg error:`, err.message);
        // 清理临时文件
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        return resolve({ ok: false, transcoded: false, outputPath: inputPath, error: err.message });
      }
      // 转码成功：替换原文件
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        fs.renameSync(tmpPath, outputPath);
        console.log(`[transcode] ✅ done: ${outputPath}`);
        resolve({ ok: true, transcoded: true, outputPath });
      } catch (e) {
        console.error(`[transcode] rename error:`, e.message);
        resolve({ ok: false, transcoded: false, outputPath: inputPath, error: e.message });
      }
    });
  });
}

function isAvailable() {
  ensureBins();
  // 用 --version 检测
  try {
    require('child_process').execSync(`"${_ffmpegPath}" -version`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  transcodeIfNeeded,
  detectVideoCodec,
  isAvailable,
};
