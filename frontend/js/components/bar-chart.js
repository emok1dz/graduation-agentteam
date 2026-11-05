// 原生 SVG 柱状图：分数段分布（FR-STAT-04）
import { h, svg } from '../utils/dom.js';

/**
 * buckets: [{ label, count, ratio }]
 * 返回 <svg>，通过 viewBox 自适应宽度
 */
export function renderBarChart(buckets, { width = 640, height = 280, title = '分数段分布' } = {}) {
  if (!buckets || !buckets.length) return h('div', { class: 'state' }, '暂无数据');
  const pad = { top: 28, right: 16, bottom: 44, left: 40 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count || 0));
  // y 轴刻度：取不超过 5 个整数刻度
  const step = Math.max(1, Math.ceil(maxCount / 5));
  const yMax = step * Math.ceil(maxCount / step);
  const slot = iw / buckets.length;
  const bw = Math.min(64, slot * 0.6);
  const kinds = ['low', 'mid', 'mid', 'high', 'high'];

  const grid = [];
  for (let v = 0; v <= yMax; v += step) {
    const y = pad.top + ih - (v / yMax) * ih;
    grid.push(svg('line', { class: v === 0 ? 'axis' : 'grid-line', x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
    grid.push(svg('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end' }, String(v)));
  }
  const bars = buckets.map((b, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const bh = ((b.count || 0) / yMax) * ih;
    const y = pad.top + ih - bh;
    return svg('g', null,
      svg('rect', { class: ['bar', kinds[i] || ''], x: cx - bw / 2, y, width: bw, height: Math.max(bh, 0), rx: 3 },
        svg('title', null, `${b.label}：${b.count} 人（${b.ratio ?? 0}%）`)),
      svg('text', { class: 'val', x: cx, y: y - 6, 'text-anchor': 'middle' }, `${b.count}人`),
      svg('text', { x: cx, y: pad.top + ih + 18, 'text-anchor': 'middle' }, b.label),
      svg('text', { x: cx, y: pad.top + ih + 34, 'text-anchor': 'middle' }, `${b.ratio ?? 0}%`));
  });
  return svg('svg', { class: 'bar-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': title, preserveAspectRatio: 'xMidYMid meet' },
    svg('title', null, title), grid, bars,
    svg('text', { x: pad.left, y: 14 }, '人数'));
}
