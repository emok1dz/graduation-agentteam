// DOM 工具：所有文本一律以 textContent / TextNode 写入，杜绝 innerHTML 注入（设计文档 §5.4）

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple', 'indeterminate', 'hidden', 'textContent']);

function isChild(v) {
  return v == null || typeof v !== 'object' || v instanceof Node || Array.isArray(v);
}

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false && !PROP_KEYS.has(k)) continue;
    if (k === 'innerHTML' || k === 'outerHTML') throw new Error('禁止使用 innerHTML');
    if (k === 'class' || k === 'className') {
      el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v));
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v); // CSSOM 赋值，不受 CSP style-src 限制
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = String(dv);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'ref' && typeof v === 'function') {
      v(el);
    } else if (PROP_KEYS.has(k)) {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

/** 安全追加子节点：支持嵌套数组，忽略 null/false（原生 append 会把 null 渲染成 "null"） */
export function append(el, ...children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, ...c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

/** h('div', {class:'x', onclick}, '文本', childNode, [..]) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (isChild(attrs)) children.unshift(attrs);
  else applyAttrs(el, attrs);
  return append(el, ...children);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** SVG 元素：属性全部 setAttribute（呈现属性不受 CSP 限制） */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (isChild(attrs)) children.unshift(attrs);
  else {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 清空后放入新内容 */
export function mount(el, ...children) {
  clear(el);
  return append(el, ...children);
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML 转义（仅供需要拼接字符串的场合，如下载文件名；页面渲染请用 h()） */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 统一的加载 / 空 / 错误状态 ----------
export function loading(text = '加载中…') {
  return h('div', { class: 'state' }, h('span', { class: 'spinner' }), text);
}

export function emptyState(text = '暂无数据', action) {
  return h('div', { class: 'state' }, h('div', { class: 'state-icon' }, '∅'), h('div', text), action || null);
}

export function errorState(err, onRetry) {
  const msg = err && err.message ? err.message : String(err || '加载失败');
  return h('div', { class: 'state error' },
    h('div', { class: 'state-icon' }, '!'),
    h('div', msg),
    onRetry ? h('button', { class: 'btn', onclick: onRetry }, '重试') : null);
}

/** 防抖 */
export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** 按钮异步操作期间自动禁用并显示“处理中” */
export async function withBusy(btn, fn, busyText = '处理中…') {
  if (!btn) return fn();
  if (btn.disabled) return undefined;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

export function badge(text, kind = '') {
  return h('span', { class: ['badge', kind && 'badge-' + kind] }, text);
}

export function pageHead(title, actions = [], crumbs = null) {
  return h('div', null,
    crumbs ? h('div', { class: 'breadcrumb' }, crumbs.map((c, i) => [i ? ' / ' : '', c.href ? h('a', { href: c.href }, c.label) : c.label])) : null,
    h('div', { class: 'page-head' }, h('h1', title), h('div', { class: 'actions' }, actions)));
}

/**
 * 在 el 中执行异步加载：显示加载态 → 成功调用 onData(data) 返回节点 → 失败显示错误态（可重试）
 */
export async function loadInto(el, fetcher, onData) {
  el.replaceChildren(loading());
  try {
    const data = await fetcher();
    if (!el.isConnected && el.parentNode === null) return undefined;
    const node = onData(data);
    if (node !== undefined) { el.replaceChildren(); append(el, node); }
    return data;
  } catch (e) {
    console.warn(e);
    el.replaceChildren(errorState(e, () => loadInto(el, fetcher, onData)));
    return undefined;
  }
}
