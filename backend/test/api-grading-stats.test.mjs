// 接口集成测试：自动阅卷（FR-GRADE-01）、人工批改（FR-GRADE-02）、发布/撤回成绩（FR-GRADE-03）、
// 学生成绩（FR-STAT-01）、成绩单与统计（FR-STAT-02~06）——统计结果与手算值逐项比对
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, buildScenario } from './helpers/harness.mjs';

/*
 * 试卷：单选 2 + 多选 4 + 判断 2 + 填空 4（2 空各 2）+ 简答 10 = 22；默认及格线 13.2
 * S1：B / [A,C] / true / [北京,1949] → 客观 12；简答 9   → 21
 * S2：A / [A]   / true / [Beijing,1950] → 客观 4；简答 5 → 9
 * S3：B / [C,A] / false / [上海,1949]  → 客观 8；简答 7.5 → 15.5
 * S4：缺考 → 0（absent）
 * S5：交白卷 → 客观 0；简答 0 → 0
 */
let h, sc, tk, stu, sid = {};
const T0 = Date.parse('2026-11-05T06:00:00.000Z');
const answersOf = {
  0: [['single', 'B'], ['multiple', ['A', 'C']], ['judge', true], ['fill', ['北京', '1949']], ['essay', 'S1 的作答']],
  1: [['single', 'A'], ['multiple', ['A']], ['judge', true], ['fill', ['Beijing', '1950']], ['essay', 'S2 的作答']],
  2: [['single', 'B'], ['multiple', ['C', 'A']], ['judge', false], ['fill', ['上海', '1949']], ['essay', 'S3 的作答']],
};
before(async () => {
  clock.setNow(T0);
  h = await startHarness();
  sc = await buildScenario(h, { students: 5, durationMinutes: 20, windowMs: 30 * 60_000 });
  tk = sc.tk;
  stu = [];
  for (const u of sc.stuNames) stu.push(await h.login(u, 'Abc12345'));
  clock.setNow(sc.startMs + 60_000);
  for (const i of [0, 1, 2, 4]) {
    const s = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: stu[i] }));
    sid[i] = s.submission_id;
  }
  for (const i of [0, 1, 2]) {
    h.ok(await h.api('POST', `/api/submissions/${sid[i]}/submit`, { token: stu[i], body: { answers: answersOf[i].map(([t, r]) => ({ paper_question_id: sc.pq[t], response: r })) } }));
  }
});
after(() => h.close());
const grade = (i, score, extra = {}) => h.api('PUT', `/api/submissions/${sid[i]}/grades`, { token: tk, body: { grades: [{ paper_question_id: sc.pq.essay, score, ...extra }] } });

test('IT-GRADE-01 客观题自动阅卷：交卷即判分，与手算一致（多选少选 0 分、填空逐空、忽略大小写）', async () => {
  const ov = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/grading`, { token: tk }));
  const by = Object.fromEntries(ov.submissions.map((s) => [s.submission_id, s]));
  assert.equal(by[sid[0]].objective_score, 12);
  assert.equal(by[sid[1]].objective_score, 4);
  assert.equal(by[sid[2]].objective_score, 8);
  assert.ok(ov.submissions.every((s) => s.status === 'pending_review' && s.total_score === null));
  assert.equal(ov.progress.total, 3, '作答中的 S5 不计入批改列表');
  assert.equal(ov.essay_questions[0].total_count, 3);
  const d = h.ok(await h.api('GET', `/api/submissions/${sid[1]}`, { token: tk }));
  const q = Object.fromEntries(d.questions.map((x) => [x.type, x]));
  assert.deepEqual([q.single.got_score, q.multiple.got_score, q.judge.got_score, q.fill.got_score, q.essay.got_score], [0, 0, 2, 2, null]);
  assert.equal(q.multiple.is_correct, false);
  assert.equal(q.fill.is_correct, false);
});

test('IT-GRADE-02 批改校验：超过分值/负数/2 位小数/非简答题 → 40000；作答中答卷 → 40902', async () => {
  h.err(await grade(0, 10.5), 400, 40000);
  h.err(await grade(0, -1), 400, 40000);
  h.err(await grade(0, 1.25), 400, 40000);
  h.err(await h.api('PUT', `/api/submissions/${sid[0]}/grades`, { token: tk, body: { grades: [{ paper_question_id: sc.pq.single, score: 1 }] } }), 400, 40000);
  h.err(await h.api('PUT', `/api/submissions/${sid[0]}/grades`, { token: tk, body: { grades: [] } }), 400, 40000);
  h.err(await h.api('PUT', `/api/submissions/${sid[0]}/grades`, { token: tk, body: { grades: [{ paper_question_id: sc.pq.essay, score: 1, comment: 'x'.repeat(501) }] } }), 400, 40000);
  h.err(await grade(4, 1), 409, 40902);
  h.err(await h.api('PUT', '/api/submissions/999999/grades', { token: tk, body: { grades: [{ paper_question_id: sc.pq.essay, score: 1 }] } }), 404, 40400);
});

test('IT-GRADE-03 人工批改：给分+评语后 graded，total=客观+主观；按题批改视图含参考答案与作答', async () => {
  const r = h.ok(await grade(0, 9, { comment: '很好' }));
  assert.deepEqual([r.status, r.objective_score, r.subjective_score, r.total_score, r.essay_graded, r.essay_total], ['graded', 12, 9, 21, 1, 1]);
  const byQ = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/grading/questions/${sc.pq.essay}`, { token: tk }));
  assert.equal(byQ.question.reference_answer, '参考答案');
  assert.equal(byQ.items.length, 3);
  assert.equal(byQ.items[0].score, null, '未批改的排在前面');
  assert.equal(byQ.items.find((i) => i.submission_id === sid[0]).comment, '很好');
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/grading/questions/${sc.pq.single}`, { token: tk }), 404, 40400);
  // 发布前可修改分数
  h.ok(await grade(0, 8));
  h.ok(await grade(0, 9));
  h.ok(await grade(1, 5));
});

test('IT-GRADE-04 发布成绩：考试未结束 40902；结束后仍有待批改 40907（pending_count）', async () => {
  h.err(await h.api('POST', `/api/exams/${sc.exam.id}/publish-results`, { token: tk, body: {} }), 409, 40902);
  // S5 白卷交卷
  h.ok(await h.api('POST', `/api/submissions/${sid[4]}/submit`, { token: stu[4], body: {} }));
  clock.setNow(sc.endMs + 1000);
  const r = h.err(await h.api('POST', `/api/exams/${sc.exam.id}/publish-results`, { token: tk, body: {} }), 409, 40907);
  assert.equal(r.data.pending_count, 2); // S3、S5
  const pre = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[0] }));
  assert.equal(pre.submission.total_score, null, '发布前学生看不到分数');
  assert.equal(pre.submission.objective_score, null);
  assert.deepEqual(pre.questions, []);
});

test('IT-GRADE-05 全部批改后发布成功；学生可见成绩与答卷回顾（含正确答案），已发布后批改 40908', async () => {
  h.ok(await grade(2, 7.5));
  h.ok(await grade(4, 0));
  const pub = h.ok(await h.api('POST', `/api/exams/${sc.exam.id}/publish-results`, { token: tk, body: { allow_review: true } }));
  assert.equal(pub.results_published, true);
  assert.equal(pub.counts.absent, 1);
  h.err(await h.api('POST', `/api/exams/${sc.exam.id}/publish-results`, { token: tk, body: {} }), 409, 40908);
  h.err(await grade(0, 1), 409, 40908);
  const res = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[2] }));
  assert.deepEqual([res.submission.objective_score, res.submission.subjective_score, res.submission.total_score, res.submission.passed], [8, 7.5, 15.5, true]);
  assert.equal(res.questions.length, 5);
  assert.deepEqual(res.questions.find((q) => q.type === 'multiple').correct_answer, ['A', 'C']);
  const s2 = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[1] }));
  assert.equal(s2.submission.passed, false);
  const absent = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[3] }));
  assert.equal(absent.submission.submit_type, 'absent');
  assert.equal(absent.submission.total_score, 0);
  const list = h.ok(await h.api('GET', '/api/student/results', { token: stu[0] }));
  assert.equal(list.items.find((x) => (x.exam_id ?? x.exam?.id) === sc.exam.id).total_score, 21);
});

test('IT-GRADE-06 撤回发布：学生分数重新隐藏、可再批改；allow_review=false 重新发布时不返回题目', async () => {
  h.ok(await h.api('POST', `/api/exams/${sc.exam.id}/unpublish-results`, { token: tk }));
  const r = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[0] }));
  assert.equal(r.submission.total_score, null);
  h.ok(await grade(0, 9));
  h.ok(await h.api('POST', `/api/exams/${sc.exam.id}/publish-results`, { token: tk, body: { allow_review: false } }));
  const r2 = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: stu[0] }));
  assert.equal(r2.submission.total_score, 21);
  assert.deepEqual(r2.questions, []);
  h.err(await h.api('POST', `/api/exams/${sc.exam.id}/unpublish-results`, { token: sc.t2 && (await h.login('teacher2', 'Teach2pass')) }), 403, 40301);
});

test('IT-STAT-01 成绩单：含缺考、竞争排名（0 分并列）、是否及格、排序方式', async () => {
  const sheet = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/scores`, { token: tk }));
  assert.equal(sheet.items.length, 5);
  assert.deepEqual(sheet.items.map((i) => [i.total_score, i.rank]), [[21, 1], [15.5, 2], [9, 3], [0, 4], [0, 4]]);
  assert.deepEqual(sheet.items.map((i) => i.passed), [true, true, false, false, false]);
  assert.equal(sheet.exam.pass_score, 13.2);
  const byName = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/scores?sort=username_asc`, { token: tk }));
  assert.deepEqual(byName.items.map((i) => i.username), [...sc.stuNames].sort());
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/scores?sort=bad`, { token: tk }), 400, 40000);
});

test('IT-STAT-02 概要统计：应考 5、实考 4、缺考 1、平均 11.38、最高 21、最低 0、及格 2 人 50%', async () => {
  const s = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/stats/summary`, { token: tk }));
  // 手算：(21+9+15.5+0)/4 = 11.375 → 11.38
  assert.deepEqual(
    [s.expected_count, s.actual_count, s.absent_count, s.average_score, s.max_score, s.min_score, s.pass_count, s.pass_rate],
    [5, 4, 1, 11.38, 21, 0, 2, 50],
  );
  assert.equal(s.by_class.length, 1);
  assert.equal(s.by_class[0].average_score, 11.38);
  const f = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/stats/summary?class_id=${sc.cls.id}`, { token: sc.admin }));
  assert.equal(f.average_score, 11.38);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/stats/summary?class_id=99999`, { token: tk }), 400, 40000);
});

test('IT-STAT-03 分数段分布：21(95.5%)→[90,100]、15.5(70.5%)→[70,80)、9 与 0 → [0,60)', async () => {
  const d = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/stats/distribution`, { token: tk }));
  assert.deepEqual(d.buckets.map((b) => b.count), [2, 0, 1, 0, 1]);
  assert.deepEqual(d.buckets.map((b) => b.ratio), [50, 0, 25, 0, 25]);
  assert.equal(d.buckets[4].max_score, 22);
});

test('IT-STAT-04 每题分析：正确率=满分人数/实考人数，选项分布，简答得分率，按正确率升序', async () => {
  const q = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/stats/questions`, { token: tk }));
  assert.equal(q.actual_count, 4);
  const by = Object.fromEntries(q.items.map((i) => [i.type, i]));
  assert.equal(by.single.correct_rate, 50);
  assert.deepEqual(by.single.option_stats.map((o) => [o.key, o.count, o.is_correct]), [['A', 1, false], ['B', 2, true], ['C', 0, false]]);
  assert.equal(by.multiple.correct_rate, 50);
  assert.deepEqual(by.multiple.option_stats.map((o) => o.count), [3, 0, 2, 0]);
  assert.equal(by.judge.correct_rate, 50);
  assert.equal(by.fill.correct_rate, 25);
  assert.equal(by.fill.avg_score, 2);
  assert.equal(by.fill.score_rate, 50);
  assert.equal(by.essay.correct_rate, null);
  assert.equal(by.essay.avg_score, 5.38); // 21.5/4 = 5.375
  assert.equal(by.essay.score_rate, 53.8); // 21.5/40
  const asc = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/stats/questions?sort=rate_asc`, { token: tk }));
  // 契约：rate_asc 按 score_rate 升序、同值按 seq；客观题得分率均 50%，简答 53.8% 排最后
  const rates = asc.items.map((i) => i.score_rate);
  assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
  assert.deepEqual(asc.items.map((i) => i.type), ['single', 'multiple', 'judge', 'fill', 'essay']);
});

test('IT-STAT-05 CSV 导出（UTF-8 BOM、含表头与 5 行）与管理员概览', async () => {
  const res = await fetch(`${h.base}/api/exams/${sc.exam.id}/scores/export`, { headers: { Authorization: `Bearer ${tk}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = buf.toString('utf8').trim().split('\r\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /排名/);
  const ov = h.ok(await h.api('GET', '/api/admin/overview', { token: sc.admin }));
  assert.ok(ov.users.total >= 9);
});
