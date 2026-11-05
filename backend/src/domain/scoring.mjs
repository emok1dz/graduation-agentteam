// 判分（系统设计文档 §4.1-5）
export const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s).trim().toLowerCase();

/** 填空每空分值：per = floor(score/n×10)/10，最后一空吸收余数 */
export function splitFillScore(score, n) {
  if (n <= 0) return [];
  const per = Math.floor((score / n) * 10 + 1e-9) / 10;
  const arr = Array(n).fill(per);
  arr[n - 1] = round1(score - per * (n - 1));
  return arr;
}

/** @returns {{score:number|null, is_correct:boolean|null}} */
export function scoreAnswer(pq, response) {
  const full = pq.score;
  if (pq.type === 'essay') return { score: null, is_correct: null };
  if (response === null || response === undefined) return { score: 0, is_correct: false };
  switch (pq.type) {
    case 'single':
    case 'judge': {
      const ok = response === pq.answer;
      return { score: ok ? full : 0, is_correct: ok };
    }
    case 'multiple': {
      if (!Array.isArray(response)) return { score: 0, is_correct: false };
      const a = [...new Set(response)].sort();
      const b = [...pq.answer].sort();
      const ok = a.length === b.length && a.every((x, i) => x === b[i]);
      return { score: ok ? full : 0, is_correct: ok };
    }
    case 'fill': {
      if (!Array.isArray(response)) return { score: 0, is_correct: false };
      const parts = splitFillScore(full, pq.blank_count);
      let got = 0;
      let all = true;
      for (let i = 0; i < pq.blank_count; i++) {
        const r = response[i];
        const accepted = (pq.answer[i] || []).map(norm);
        if (typeof r === 'string' && r.trim() !== '' && accepted.includes(norm(r))) got += parts[i];
        else all = false;
      }
      return { score: round1(got), is_correct: all };
    }
    default:
      return { score: 0, is_correct: false };
  }
}

/** 校验学生作答形状；返回错误信息或 null。null 作答（未答）总是合法 */
export function validateResponseShape(pq, response) {
  if (response === null) return null;
  if (response === undefined) return '缺少 response 字段';
  const keys = (pq.options || []).map((o) => o.key);
  switch (pq.type) {
    case 'single':
      return typeof response === 'string' && keys.includes(response) ? null : '单选题作答必须为某个选项编号';
    case 'multiple':
      if (!Array.isArray(response)) return '多选题作答必须为选项编号数组';
      if (new Set(response).size !== response.length) return '多选题作答不能重复';
      return response.every((k) => typeof k === 'string' && keys.includes(k)) ? null : '多选题作答必须为已有选项编号';
    case 'judge':
      return typeof response === 'boolean' ? null : '判断题作答必须为 true 或 false';
    case 'fill':
      if (!Array.isArray(response) || response.length !== pq.blank_count) return `填空题作答必须为长度 ${pq.blank_count} 的字符串数组`;
      return response.every((s) => typeof s === 'string' && s.length <= 500) ? null : '填空题每空必须为字符串（≤500 字）';
    case 'essay':
      if (typeof response !== 'string') return '简答题作答必须为字符串';
      return [...response].length <= 2000 ? null : '简答题作答不能超过 2000 字';
    default:
      return '未知题型';
  }
}

/** 规范化作答（多选升序存储） */
export function normalizeResponse(pq, response) {
  if (pq.type === 'multiple' && Array.isArray(response)) return [...response].sort();
  return response;
}
