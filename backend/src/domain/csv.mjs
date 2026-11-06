// CSV：转义逗号/引号/换行，前置 UTF-8 BOM
// 防 CSV 公式注入（OWASP）：以 = + - @ 制表符 回车 开头的文本单元格前置单引号
const FORMULA_START = /^[=+\-@\t\r]/;
const esc = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers, rows) {
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
