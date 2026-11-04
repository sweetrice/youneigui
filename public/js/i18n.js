'use strict';

/**
 * 有内鬼 · 极简 i18n
 *
 * LANGS.zh 同时承担两个角色：词典（key=中文, value=英文）+ 默认语言（zh）
 * 要加新词条？在下面加一行 `'中文': 'English'` 即可
 * 要加新语言？复制 LANGS.zh 改成 LANGS.ja（key=中文不变，value=日语）
 */

const LANGS = {
  // ============ <title> 完整短语（最长匹配优先，必须单独列） ============
  '有内鬼 · 创建会话': 'YouNeiGui · Create a Room',
  '有内鬼 · 正在加入...': 'YouNeiGui · Joining...',

  // ============ 通用短标题 ============
  '使用场景': 'Use Cases',
  '标题': 'Title',

  // ============ index.html（登录页 + 首页） ============
  '有内鬼': 'YouNeiGui',
  '有内鬼 · 聊天内容自动销毁，不留痕': 'YouNeiGui · Ephemeral chat that burns after',
  '有内鬼，终止交易。': '"YouNeiGui" — Cancel the transaction.',
  '临时沟通协商窗口': 'Ephemeral chat window',
  '聊成了自愿加好友，聊崩了一键取消交易，数据立即清空，谁也不欠谁。': 'Chat freely. If it works out, exchange contacts. If not, one tap ends it — data gone instantly, no strings attached.',
  '发起临时会话': 'Start a temporary room',
  '创建新会话': 'Create a new room',
  '创建一个有有效期的临时聊天室，发链接给对方，聊完即焚。': 'Create a timed chat room. Share the link. Chat burns after.',
  '销售想介绍产品但客户不想加微信？': 'Sales pitch but prospect won\'t add you on WeChat?',
  '项目说明书发出去有人来咨询细节？': 'Sent a spec sheet and got inquiries?',
  '线下活动结束想临时讨论？': 'Post-event quick discussion?',
  '用有内鬼，聊崩了任何一方一键结束，数据立即清空。': 'Use YouNeiGui. Anyone can end it with one tap. Data gone.',
  '使用 GitHub 登录': 'Sign in with GitHub',
  '微信扫码登录': 'WeChat QR Login',
  '📱 微信扫码登录': '📱 WeChat QR Login',
  '打开微信，扫描下方二维码授权': 'Open WeChat and scan the QR code to sign in',
  '用微信扫描下方二维码授权登录': 'Scan with WeChat to sign in',
  '登录初始化失败': 'Login init failed',
  '我们仅存储昵称和头像用于会话内展示，销毁后立即清除': 'We only store nickname and avatar for in-room display. Cleared on destroy.',
  '退出登录': 'Sign out',
  '输入房间码或分享链接': 'Enter room code or paste link',
  '加入': 'Join',
  '或者': 'OR',
  '请先登录': 'Please sign in first',
  '加载中': 'Loading…',
  '正在查找会话': 'Finding room…',

  // ============ create.html ============
  '返回': 'Back',
  '创建会话': 'Create a Room',
  '会话主题': 'Topic',
  '比如：项目咨询、合作沟通、临时讨论': 'e.g. project inquiry, partnership chat, quick discussion',
  '销毁时间': 'Destroy in',
  '自定义天数': 'Custom days',
  '30 分钟': '30 min',
  '2 小时': '2 h',
  '6 小时': '6 h',
  '24 小时': '24 h',
  '3 天': '3 d',
  '7 天': '7 d',
  '自定义': 'Custom',
  '创建并分享': 'Create & Share',
  '创建成功': 'Created!',
  '创建中': 'Creating…',
  '请稍候': 'Please wait',
  '请填写会话主题': 'Please enter a topic',
  '请选择销毁时间': 'Please pick a destroy time',
  '创建失败，请重试': 'Create failed, please retry',
  '房间号': 'Room code',
  '房间码': 'Room code',
  '分享链接': 'Share link',
  '复制链接': 'Copy link',
  '已复制': 'Copied',
  '复制': 'Copy',
  '房间码已复制': 'Room code copied',
  '分享链接已复制': 'Share link copied',
  '链接已复制到剪贴板': 'Link copied to clipboard',
  '扫描二维码加入': 'Scan to join',
  '生成二维码': 'Generating QR',
  '动态生成': 'Dynamic',
  '短链接': 'Short link',
  '如：XX项目说明书咨询': 'e.g. Spec sheet inquiry',
  '天': 'days',

  // ============ join.html ============
  '正在加入': 'Joining…',
  '正在加入会话': 'Joining room…',
  '加入会话': 'Join Room',
  '加入失败': 'Join failed',
  '加入失败，请重试': 'Join failed, please retry',
  '会话不存在或已销毁': 'Room does not exist or already destroyed',
  '返回首页': 'Back home',
  '聊天室': 'Chat room',
  '输入房间码，如': 'Enter room code, e.g.',
  '进入会话': 'Enter room',

  // ============ room.html（聊天室） ============
  '离开': 'Leave',
  '发送': 'Send',
  '输入消息，Enter 发送': 'Type a message. Enter to send.',
  '说点什么...': 'Say something…',
  '说点什么': 'Say something…',
  '发送消息': 'Send message',
  'WebSocket 未连接，消息发送失败。请刷新页面。': 'WebSocket not connected. Refresh and retry.',
  '未连接，消息发送失败。请启动': 'Not connected. Please start',
  '不可用，走': 'Unavailable, falling back to',
  '网络断开，正在重连': 'Disconnected. Reconnecting…',
  '网络错误，请重试': 'Network error, please retry',
  '简单重连': 'Simple reconnect',
  '刷新': 'Refresh',
  '后刷新页面': 'Refresh page after',
  '后刷新页面。': 'Refresh page after.',
  '已销毁': 'Destroyed',
  '会话已销毁': 'Room has been destroyed',
  '会话已销毁，无法导出': 'Room destroyed, cannot export',
  '已结束会话': 'Room ended',
  '所有数据已永久清除': 'All data permanently erased',
  '正在加入会话': 'Joining room…',
  '正在查找会话': 'Finding room…',
  '创建新会话': 'Create new room',
  '回到首页': 'Home',
  '项目说明书咨询': 'Spec sheet inquiry',

  // ============ 系统消息 ============
  '由': 'by',
  '发起销毁': 'destroyed the room',
  '已退出会话': 'left the room',
  '已加入会话': 'joined the room',
  '会话已创建': 'Room created',
  '大家好，会话已创建': 'Room created. Say hi!',
  '剩余': 'Remaining',
  '后自动销毁': 'until auto-destroy',

  // ============ 销毁确认弹窗 ============
  '确定要结束会话吗？': 'End this room?',
  '此操作不可撤销。': 'This cannot be undone.',
  '结束后将立即删除所有消息数据，所有成员断开，双方都无法再发送或导出内容。': 'All messages will be deleted immediately. All members disconnected. Neither side can send or export.',
  '结束会话': 'End Room',
  '确定结束': 'End Now',
  '取消': 'Cancel',
  '结束会话失败': 'End room failed',
  '结束会话二次确认弹窗': 'End room confirmation',
  '导出': 'Export',
  '导出文件仍然保存在本地。': 'Exported file stays on your local machine.',
  '你已经做好的 Markdown 导出文件仍然保存在本地。': 'Your exported Markdown file stays on your local machine.',
  '导出 Markdown（销毁前可导出）': 'Export Markdown (available before destroy)',
  '结束会话（立即销毁，所有人断开，数据不可恢复）': 'End room (immediately destroys for all. Irreversible.)',
  '临时沟通协商窗口：聊成了自愿加好友，聊崩了一键取消交易，数据立即清空，谁也不欠谁。': 'Ephemeral chat: connect freely, or one-tap vanish — no social residue.',

  // ============ Markdown 导出 ============
  '会话主题': 'Topic',
  '创建时间': 'Created',
  '销毁时间': 'Destroy at',
  '销毁触发方式': 'Destroyed by',
  '手动终止': 'Manual end',
  '到期自动销毁': 'Auto-destroy (TTL)',
  '成员': 'Members',
  '消息数': 'Messages',
  '销毁后状态': 'Status',
  '刷新时用': 'on refresh',
  '已登录': 'Signed in',
  '未登录': 'Not signed in',

  // ============ 倒计时提醒 ============
  '1 小时后自动销毁': 'Auto-destroy in 1 hour',
  '10 分钟后自动销毁': 'Auto-destroy in 10 minutes',
  '1 分钟后自动销毁': 'Auto-destroy in 1 minute',
  '即将销毁': 'Destroying soon',

  // ============ 状态 / 系统 ============
  '状态': 'Status',
  '显示登录页': 'Show login page',
  '显示首页': 'Show home',
  '检查登录': 'Check login',
  '验证登录': 'Verify login',
  '初始化': 'Init',
  '渲染': 'Render',
  '获取预设': 'Get presets',
  '渲染预设按钮': 'Render preset buttons',
  '创建按钮': 'Create button',
  '进入会话': 'Enter room',
  '查房间': 'Get room',
  '更新本地': 'Update local',
  '推送回来': 'Push back',
  '销毁事件会通过': 'Destroy event via',
  '推回来': 'push back',
  '简单重连': 'Simple reconnect',
};

// 合成 zh → en 映射（直接用 LANGS 对象本身，key 就是中文）
const PAIRS = new Map(Object.entries(LANGS));

let currentLang = localStorage.getItem('yg.lang') ||
  (navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

/**
 * 遍历 body 下所有 textNode，匹配 PAIRS 就替换
 */
function translate(root, targetLang) {
  if (targetLang === 'zh') return;
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      // 跳过 data-i18n 属性里的内容（比如 title tooltip）——不，title 也是 textNode，一起翻
      // 跳过已经处理过的
      if (parent.dataset && parent.dataset.i18nDone) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // 收集所有 textNode，按匹配长度降序排序（长的先匹配，防止短的先吃掉一部分）
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  for (const node of nodes) {
    let orig = node.nodeValue;
    // 按词典里 value（英文）长度降序，保证最长匹配优先
    const sorted = [...PAIRS.entries()].sort((a, b) => b[0].length - a[0].length);
    let replaced = false;
    for (const [zh, en] of sorted) {
      if (orig.includes(zh)) {
        orig = orig.split(zh).join(en);
        replaced = true;
      }
    }
    if (replaced) {
      node.nodeValue = orig;
      if (node.parentElement) node.parentElement.dataset.i18nDone = '1';
    }
  }

  // <title> — 也按最长匹配优先
  if (document.title) {
    let t = document.title;
    const sorted = [...PAIRS.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [zh, en] of sorted) {
      if (t.includes(zh)) t = t.split(zh).join(en);
    }
    document.title = t;
  }

  // 同时处理 <input>/<textarea placeholder> 和 [title]（按中文 key 长度降序，最长匹配优先）
  const sortedAttrs = [...PAIRS.entries()].sort((a, b) => b[0].length - a[0].length);
  document.querySelectorAll('input[placeholder], textarea[placeholder], [title]').forEach((el) => {
    const attr = el.hasAttribute('placeholder') ? 'placeholder' : 'title';
    let v = el.getAttribute(attr);
    if (!v) return;
    let changed = false;
    for (const [zh, en] of sortedAttrs) {
      if (v.includes(zh)) { v = v.split(zh).join(en); changed = true; }
    }
    if (changed) el.setAttribute(attr, v);
  });
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('yg.lang', lang);
  location.reload();
}

function initI18n() {
  translate(document.body, currentLang);

  document.querySelectorAll('[data-i18n-switch]').forEach((btn) => {
    btn.textContent = currentLang === 'zh' ? 'EN' : '中';
    btn.addEventListener('click', () => {
      setLang(currentLang === 'zh' ? 'en' : 'zh');
    });
  });
}

window.i18n = {
  t: (zhText) => PAIRS.get(zhText) || zhText,
  get current() { return currentLang; },
  set: setLang,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initI18n);
} else {
  initI18n();
}
