// 分页组件
import { h } from '../utils/dom.js';

export function renderPagination({ page = 1, page_size = 10, total = 0 }, onChange) {
  const pages = Math.max(1, Math.ceil(total / page_size));
  const btn = (label, p, { disabled = false, current = false } = {}) =>
    h('button', { class: ['btn', 'btn-sm', current && 'current'], type: 'button', disabled: disabled || current, onclick: () => onChange(p) }, label);
  const nums = [];
  const from = Math.max(1, page - 2);
  const to = Math.min(pages, page + 2);
  if (from > 1) { nums.push(btn('1', 1)); if (from > 2) nums.push(h('span', '…')); }
  for (let p = from; p <= to; p++) nums.push(btn(String(p), p, { current: p === page }));
  if (to < pages) { if (to < pages - 1) nums.push(h('span', '…')); nums.push(btn(String(pages), pages)); }
  return h('div', { class: 'pagination' },
    h('span', { class: 'muted' }, `共 ${total} 条`),
    btn('‹', page - 1, { disabled: page <= 1 }),
    nums,
    btn('›', page + 1, { disabled: page >= pages }));
}
