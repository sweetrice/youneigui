'use strict';

/**
 * 有内鬼 · 极简 i18n 方案
 *
 * 设计思路：
 *   - 中文原文就是 key，英文是 value
 *   - 页面加载完遍历所有文本节点，匹配词典就替换
 *   - <script> / <style> / <title> / data 属性里的内容不动
 *   - 切换语言：改 localStorage 再 dispatch 一个 'i18n:change' 事件
 *
 * 要加新语言？复制 LANGS.en，改成 LANGS.ja / LANGS.ko ... 即可
 * 要加新词条？在 LANGS.zh 和 LANGS.en 里都写一条
 */

const LANGS = {
  zh: {
    // ============ index.html（登录页 + 首页） ============
    '登录以创建或加入临时会话，聊完即焚，不沉淀任何社交关系': 'Sign in to create or join a temporary room. Chat burns after, no social footprint.',
    '使用 GitHub 登录': 'Sign in with GitHub',
    '开发模式 Mock 登录': 'Mock sign in (dev only)',
    '我们仅存储你的昵称和头像用于会话内展示，销毁后立即清除': 'We only store your nickname & avatar for in-room display, erased on destroy.',
    '已有账号': 'Already signed in',
    '退出登录': 'Sign out',
    '创建会话': 'Create a room',
    '加入会话': 'Join a room',
    '输入房间号或分享链接': 'Enter room code or paste link',
    '加入': 'Join',
    '或者': 'OR',
    '错误': 'Error',
    '请先登录': 'Please sign in first',
    '加载中': 'Loading…',

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
    '创建并分享': 'Create & Share',
    '创建成功': 'Created!',
    '房间号': 'Room code',
    '分享链接': 'Share link',
    '复制链接': 'Copy link',
    '已复制': 'Copied',
    '扫描二维码加入': 'Scan to join',
    '链接已复制到剪贴板': 'Link copied to clipboard',
    '创建失败，请重试': 'Create failed, please retry',

    // ============ join.html ============
    '正在加入': 'Joining…',
    '会话不存在或已销毁': 'Room does not exist or already destroyed',
    '返回首页': 'Back home',
    '加入会话': 'Join Room',

    // ============ room.html（聊天室） ============
    '离开': 'Leave',
    '房间号': 'Room',
    '复制': 'Copy',
    '导出 Markdown（销毁前可导出）': 'Export Markdown (available before destroy)',
    '结束会话（立即销毁，所有人断开，数据不可恢复）': 'End room (immediately destroys for all. Irreversible.)',
    '发送': 'Send',
    '输入消息，Enter 发送': 'Type a message. Enter to send.',
    'WebSocket 未连接，消息发送失败。请刷新页面。': 'WebSocket not connected. Refresh to retry.',
    '网络断开，正在重连': 'Disconnected. Reconnecting…',
    '已销毁': 'Destroyed',
    '会话已销毁': 'Room has been destroyed',
    '由': 'by',
    '发起销毁': 'destroyed the room',
    '已退出会话': 'left the room',
    '已加入会话': 'joined the room',
    '大家好，会话已创建': 'Room created. Say hi!',
    '剩余': 'Remaining',
    '后自动销毁': 'until auto-destroy',

    // ============ 销毁确认弹窗 ============
    '确定结束会话吗？': 'End this room?',
    '此操作将立即销毁聊天室，所有人断开，聊天记录不可恢复。': 'This destroys the room immediately for everyone. Chat history cannot be recovered.',
    '取消': 'Cancel',
    '确定结束': 'End Now',

    // ============ 导出 ============
    '会话导出（Markdown）': 'Room Export (Markdown)',
    '销毁时间': 'Destroy time',
    '成员': 'Members',
    '消息总数': 'Total messages',

    // ============ Markdown 导出文案 ============
    '会话主题': 'Topic',
    '创建时间': 'Created',
    '销毁触发方式': 'Destroyed by',
    '手动终止': 'Manual end',
    '到期自动销毁': 'Auto-destroy (TTL)',

    // ============ 倒计时（1h / 10min / 1min 提醒） ============
    '1 小时后自动销毁': 'Auto-destroy in 1 hour',
    '10 分钟后自动销毁': 'Auto-destroy in 10 minutes',
    '1 分钟后自动销毁': 'Auto-destroy in 1 minute',
    '即将销毁': 'Destroying soon',

    // ============ title / meta ============
    '有内鬼': 'YouNeiGui',
    '有内鬼 · 聊天内容自动销毁，不留痕': 'YouNeiGui · Ephemeral chat that burns after',
    '创建会话': 'Create Room',
  },

  en: {
    // 留空 — 运行时检测到当前 lang=en 时把 zh 词典里的中文替换成这里的英文
  },
};

// 构造 zh → en 双字段的映射（自动从 LANGS.zh + LANGS.en 合成）
const PAIRS = (() => {
  const pairs = new Map();
  for (const zh of Object.keys(LANGS.zh)) {
    pairs.set(zh, LANGS.en[zh] || zh); // 英文没写就 fallback 中文
  }
  return pairs;
})();

let currentLang = localStorage.getItem('yg.lang') ||
  (navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

/**
 * 深度替换元素内所有文本节点
 */
function translate(root, targetLang) {
  if (targetLang === 'zh') return; // 默认就是中文，不替换
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      // 跳过已经替换过的标记节点（防止重复替换）
      if (parent.dataset && parent.dataset.i18nDone) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // 先收集再改，避免 walker 迭代时变动
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  for (const node of nodes) {
    const orig = node.nodeValue;
    const trimmed = orig.trim();
    if (PAIRS.has(trimmed)) {
      node.nodeValue = orig.replace(trimmed, PAIRS.get(trimmed));
      // 标记父节点已处理，防止 DOM 更新后重入
      if (node.parentElement) node.parentElement.dataset.i18nDone = '1';
    }
  }

  // title 标签
  if (document.title) {
    for (const [zh, en] of PAIRS) {
      if (document.title.includes(zh)) {
        document.title = document.title.replace(zh, en);
      }
    }
  }
}

/**
 * 切换语言
 */
function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('yg.lang', lang);
  // 清掉 i18nDone 标记让 translate 能重跑（但中文状态我们就不替换了，直接 reload 最干净）
  location.reload();
}

function initI18n() {
  translate(document.body, currentLang);

  // 语言切换按钮：支持页面上多个（loginView / homeView 各一个）
  document.querySelectorAll('[data-i18n-switch]').forEach((btn) => {
    btn.textContent = currentLang === 'zh' ? 'EN' : '中';
    btn.addEventListener('click', () => {
      setLang(currentLang === 'zh' ? 'en' : 'zh');
    });
  });
}

// 暴露到全局，方便 HTML 内联脚本和 WebSocket 事件里生成的中文也能替换
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
