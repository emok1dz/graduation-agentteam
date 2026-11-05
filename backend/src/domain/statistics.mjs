// 统计纯函数：概要、分数段、每题分析、排名
import { round1, round2 } from './scoring.mjs';

/** rows: [{total_score}]（已是统计对象） */
export function summarize(rows, passScore) {
  const n = rows.length;
  if (n === 0) return { actual_count: 0, average_score: null, max_score: null, min_score: null, pass_count: 0, pass_rate: 0 };
  const scores = rows.map((r) => r.total_score);
  const pass = scores.filter((s) => s >= passScore - 1e-9).length;
  return {
    actual_count: n,
    average_score: round2(scores.reduce((a, b) => a + b, 0) / n),
    max_score: Math.max(...scores),
    min_score: Math.min(...scores),
    pass_count: pass,
    pass_rate: round1((pass / n) * 100),
  };
}

const BUCKETS = [
  [0, 60, '[0%,60%)'],
  [60, 70, '[60%,70%)'],
  [70, 80, '[70%,80%)'],
  [80, 90, '[80%,90%)'],
  [90, 100, '[90%,100%]'],
];

export function distribution(rows, totalScore) {
  const n = rows.length;
  const counts = BUCKETS.map(() => 0);
  for (const r of rows) {
    const rate = totalScore > 0 ? Math.round((r.total_score / totalScore) * 100 * 1e6) / 1e6 : 0;
    let idx = BUCKETS.findIndex(([min, max], i) => rate >= min && (i === BUCKETS.length - 1 ? true : rate < max));
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return BUCKETS.map(([min, max, label], i) => ({
    label,
    min_rate: min,
    max_rate: max,
    min_score: round1((totalScore * min) / 100),
    max_score: round1((totalScore * max) / 100),
    count: counts[i],
    ratio: n ? round1((counts[i] / n) * 100) : 0,
  }));
}

/**
 * @param pqs 试卷题目快照
 * @param answersBySub Map<submission_id, Map<paper_question_id, answer>>
 * @param subIds 统计对象答卷 ID
 */
export function questionStats(pqs, answersBySub, subIds) {
  const n = subIds.length;
  return pqs.map((pq) => {
    let sum = 0;
    let full = 0;
    const optCount = new Map((pq.options || []).map((o) => [o.key, 0]));
    for (const sid of subIds) {
      const a = answersBySub.get(sid)?.get(pq.id);
      const s = a?.score ?? 0;
      sum += s;
      if (a && a.score !== null && Math.abs(a.score - pq.score) < 1e-9) full++;
      if ((pq.type === 'single' || pq.type === 'multiple') && a && a.response !== null) {
        const keys = Array.isArray(a.response) ? a.response : [a.response];
        for (const k of keys) if (optCount.has(k)) optCount.set(k, optCount.get(k) + 1);
      }
    }
    const correctKeys = pq.type === 'single' ? [pq.answer] : pq.type === 'multiple' ? pq.answer || [] : [];
    return {
      paper_question_id: pq.id,
      seq: pq.seq,
      type: pq.type,
      stem_summary: [...pq.stem].slice(0, 50).join(''),
      difficulty: pq.difficulty,
      tags: pq.tags || [],
      score: pq.score,
      attempt_count: n,
      full_score_count: full,
      avg_score: n ? round2(sum / n) : 0,
      correct_rate: pq.type === 'essay' ? null : n ? round1((full / n) * 100) : 0,
      score_rate: n && pq.score ? round1((sum / (n * pq.score)) * 100) : 0,
      option_stats:
        pq.type === 'single' || pq.type === 'multiple'
          ? [...optCount.entries()].map(([key, count]) => ({
              key, count, ratio: n ? round1((count / n) * 100) : 0, is_correct: correctKeys.includes(key),
            }))
          : [],
    };
  });
}

/** 竞争排名（1,1,3）：仅对 graded 行；rows 原地写 rank */
export function rankRows(rows) {
  const graded = rows.filter((r) => r.status === 'graded' && r.total_score !== null).sort((a, b) => b.total_score - a.total_score);
  let prev = null;
  let rank = 0;
  graded.forEach((r, i) => {
    if (prev === null || Math.abs(r.total_score - prev) > 1e-9) rank = i + 1;
    r.rank = rank;
    prev = r.total_score;
  });
  for (const r of rows) if (r.rank === undefined) r.rank = null;
  return rows;
}
