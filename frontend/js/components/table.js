// 表格组件
import { h } from '../utils/dom.js';

/**
 * columns: [{ title, key, render(row, index) → Node|string, className, headClass }]
 * opts: { onRowClick(row), empty, rowClass(row), rowKey }
 */
export function renderTable(columns, rows, opts = {}) {
  const thead = h('thead', h('tr', columns.map((c) => h('th', { class: c.headClass || c.className || null }, c.title))));
  let tbody;
  if (!rows || rows.length === 0) {
    tbody = h('tbody', h('tr', h('td', { colspan: columns.length, class: 'table-empty' }, opts.empty || '暂无数据')));
  } else {
    tbody = h('tbody', rows.map((row, i) => {
      const tr = h('tr', { class: [opts.onRowClick && 'clickable', opts.rowClass && opts.rowClass(row)] },
        columns.map((c) => {
          const v = c.render ? c.render(row, i) : row[c.key];
          return h('td', { class: c.className || null }, v == null || v === '' ? '—' : v);
        }));
      if (opts.onRowClick) {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select, label, textarea')) return;
          opts.onRowClick(row);
        });
      }
      return tr;
    }));
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, thead, tbody));
}
