// 单元测试：domain/statistics（概要、分数段、每题分析、竞争排名）——与手算结果比对
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, distribution, questionStats, rankRows } from '../src/domain/statistics.mjs';

test('UT-STAT-01 summarize：平均分 2 位小数、最高/最低、及格率 1 位小数', () => {
  // 手算：[90, 75.5, 60, 59.5] → 和 285 / 4 = 71.25；及格(≥60) 3 人 → 75.0%
  const r = summarize([90, 75.5, 60, 59.5].map((total_score) => ({ total_score })), 60);
  assert.deepEqual(r, { actual_count: 4, average_score: 71.25, max_score: 90, min_score: 59.5, pass_count: 3, pass_rate: 75 });
  // 手算：[1,2,2] 平均 1.666… → 1.67；及格线 2 → 2/3 = 66.666…% → 66.7
  const r2 = summarize([1, 2, 2].map((total_score) => ({ total_score })), 2);
  assert.equal(r2.average_score, 1.67);
  assert.equal(r2.pass_rate, 66.7);
});

test('UT-STAT-02 summarize 空集合', () => {
  assert.deepEqual(summarize([], 60), { actual_count: 0, average_score: null, max_score: null, min_score: null, pass_count: 0, pass_rate: 0 });
});

test('UT-STAT-03 distribution：5 段边界（左闭右开，最后一段含 100%）', () => {
  // 总分 50：29.9(59.8%)→0；30(60%)→1；34.9(69.8%)→1；35(70%)→2；44.9→3（89.8%）；45(90%)→4；50(100%)→4
  const rows = [29.9, 30, 34.9, 35, 44.9, 45, 50, 0].map((total_score) => ({ total_score }));
  const d = distribution(rows, 50);
  assert.deepEqual(d.map((b) => b.count), [2, 2, 1, 1, 2]);
  assert.deepEqual(d.map((b) => b.label), ['[0%,60%)', '[60%,70%)', '[70%,80%)', '[80%,90%)', '[90%,100%]']);
  assert.equal(d[0].ratio, 25); // 2/8
  assert.equal(d[1].min_score, 30);
  assert.equal(d[4].max_score, 50);
  const empty = distribution([], 100);
  assert.ok(empty.every((b) => b.count === 0 && b.ratio === 0));
});

test('UT-STAT-04 distribution：浮点 70% 不落入 [60,70)（46 分卷 32.2 分）', () => {
  // 32.2/46 = 0.7 → 70%
  const d = distribution([{ total_score: 32.2 }], 46);
  assert.equal(d[2].count, 1);
});

test('UT-STAT-05 questionStats：正确率=满分人数/实考，选项分布，简答 correct_rate=null', () => {
  const pqs = [
    { id: 1, seq: 1, type: 'single', stem: '单选', score: 2, answer: 'B', options: [{ key: 'A' }, { key: 'B' }], difficulty: 'easy', tags: ['t'] },
    { id: 2, seq: 2, type: 'multiple', stem: '多选', score: 4, answer: ['A', 'B'], options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }], difficulty: 'easy' },
    { id: 3, seq: 3, type: 'essay', stem: '简答', score: 10, answer: '', options: [], difficulty: 'hard' },
  ];
  const m = (entries) => new Map(entries.map(([pid, a]) => [pid, a]));
  const answers = new Map([
    [10, m([[1, { score: 2, response: 'B' }], [2, { score: 4, response: ['A', 'B'] }], [3, { score: 8, response: 'x' }]])],
    [11, m([[1, { score: 0, response: 'A' }], [2, { score: 0, response: ['A', 'C'] }], [3, { score: 5, response: 'y' }]])],
    [12, m([[1, { score: 2, response: 'B' }], [2, { score: 0, response: null }], [3, { score: 0, response: null }]])],
  ]);
  const [s, mu, es] = questionStats(pqs, answers, [10, 11, 12]);
  assert.equal(s.correct_rate, 66.7); // 2/3
  assert.equal(s.avg_score, 1.33); // 4/3
  assert.deepEqual(s.option_stats, [{ key: 'A', count: 1, ratio: 33.3, is_correct: false }, { key: 'B', count: 2, ratio: 66.7, is_correct: true }]);
  assert.equal(mu.correct_rate, 33.3);
  assert.deepEqual(mu.option_stats.map((o) => o.count), [2, 1, 1]);
  assert.deepEqual(mu.option_stats.map((o) => o.is_correct), [true, true, false]);
  assert.equal(es.correct_rate, null);
  assert.equal(es.avg_score, 4.33); // 13/3
  assert.equal(es.score_rate, 43.3); // 13/30
  assert.deepEqual(es.option_stats, []);
  assert.equal(s.stem_summary, '单选');
  const none = questionStats(pqs, new Map(), []);
  assert.equal(none[0].correct_rate, 0);
  assert.equal(none[0].avg_score, 0);
});

test('UT-STAT-06 rankRows：竞争排名 1,1,3，非 graded 行 rank=null', () => {
  const rows = [
    { id: 'a', status: 'graded', total_score: 80 },
    { id: 'b', status: 'graded', total_score: 90 },
    { id: 'c', status: 'graded', total_score: 80 },
    { id: 'd', status: 'pending_review', total_score: null },
    { id: 'e', status: 'graded', total_score: 70 },
  ];
  rankRows(rows);
  const r = Object.fromEntries(rows.map((x) => [x.id, x.rank]));
  assert.deepEqual(r, { a: 2, b: 1, c: 2, d: null, e: 4 });
});
