/* 有内鬼 · 公共 JS
 * fetch 封装 + helper
 */
const api = {
  async get(path) { return this._request('GET', path); },
  async post(path, data) { return this._request('POST', path, data); },
  async put(path, data) { return this._request('PUT', path, data); },

  async _request(method, path, data) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(path, opts);
    if (res.status === 401) {
      // 未登录跳登录页
      if (location.pathname !== '/' && location.pathname !== '/index.html') {
        sessionStorage.setItem('redirectAfterLogin', location.pathname + location.search);
      }
      window.location.href = '/';
      throw new Error('not_authenticated');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 有些 endpoint 返回纯文本（如 export），直接返回 response
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();
    return res;
  },
};
