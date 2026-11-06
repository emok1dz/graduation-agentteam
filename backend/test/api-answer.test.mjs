// 接口集成测试：在线答题（FR-ANS-01/03/04、NFR-07/08/11）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, buildScenario } from './helpers/harness.mjs';

let h, sc, tokens;
const T0 = Date.parse('2026-11-05T04:00:00.000Z');
before(async () => {
  clock.setNow(T0);
  h = await startHarness();
  sc = await buildScenario(h, { students: 8, durationMinutes: 10 });
  tokens = [];
  for (const u of sc.stuNames) tokens.push(await h.login(u, 'Abc12345'));
});
after(() => h.close());
const start = (i) => h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: tokens[i] });
const save = (i, sid, answers) => h.api('PUT', `/api/submissions/${sid}/answers`, { token: tokens[i], body: { answers } });
const submit = (i, sid, body = {}) => h.api('POST', `/api/submissions/${sid}/submit`, { token: tokens[i], body });

test('IT-ANS-01 不在时间窗口：开考前 start → 409/40905', async () => {
  h.err(await start(0), 409, 40905);
});

test('IT-ANS-02 开始作答：返回答题视图，不含答案/解析；截止=min(开始+时长, 结束)；服务端时间', async () => {
  clock.setNow(sc.startMs + 60_000);
  const s = h.ok(await start(0));
  assert.equal(s.started_at, new Date(sc.startMs + 60_000).toISOString());
  assert.equal(s.deadline_at, new Date(sc.startMs + 60_000 + 10 * 60_000).toISOString());
  assert.equal(s.server_time, s.started_at);
  assert.equal(s.questions.length, 5);
  for (const q of s.questions) {
    assert.deepEqual(Object.keys(q).sort(), ['blank_count', 'id', 'options', 'score', 'seq', 'stem', 'type']);
  }
  const raw = JSON.stringify(s);
  assert.ok(!raw.includes('参考答案') && !raw.includes('"answer"') && !raw.includes('analysis'));
  assert.ok(s.answers.every((a) => a.response === null));
});

test('IT-ANS-03 自动保存：成功返回 saved_at；断点恢复（再次 start 不重置 started_at，答案保留）', async () => {
  const s = h.ok(await start(0));
  const r = h.ok(await save(0, s.submission_id, [{ paper_question_id: sc.pq.single, response: 'B' }, { paper_question_id: sc.pq.multiple, response: ['C', 'A'] }]));
  assert.equal(r.saved_at, clock.nowIso());
  assert.equal(r.deadline_at, s.deadline_at);
  clock.advance(30_000);
  h.ok(await save(0, s.submission_id, [{ paper_question_id: sc.pq.single, response: 'A' }])); // 覆盖
  const again = h.ok(await start(0));
  assert.equal(again.started_at, s.started_at);
  assert.equal(again.last_saved_at, clock.nowIso());
  const by = Object.fromEntries(again.answers.map((a) => [a.paper_question_id, a.response]));
  assert.equal(by[sc.pq.single], 'A');
  assert.deepEqual(by[sc.pq.multiple], ['A', 'C'], '多选规范化为升序');
});

test('IT-ANS-04 保存校验：形状错误/非本卷题/空列表/非数组 → 40000', async () => {
  const s = h.ok(await start(0));
  h.err(await save(0, s.submission_id, [{ paper_question_id: sc.pq.judge, response: 'yes' }]), 400, 40000);
  h.err(await save(0, s.submission_id, [{ paper_question_id: sc.pq.fill, response: ['only-one'] }]), 400, 40000);
  h.err(await save(0, s.submission_id, [{ paper_question_id: 999999, response: 'A' }]), 400, 40000);
  h.err(await save(0, s.submission_id, []), 400, 40000);
  h.err(await h.api('PUT', `/api/submissions/${s.submission_id}/answers`, { token: tokens[0], body: { answers: 'x' } }), 400, 40000);
  h.err(await save(0, 999999, [{ paper_question_id: sc.pq.single, response: 'A' }]), 404, 40400);
});

test('IT-ANS-05 手动交卷：pending_review（含简答）、submit_type=manual、交卷时附带答案生效；请求体伪造时间被忽略', async () => {
  const s = h.ok(await start(0));
  const r = h.ok(await submit(0, s.submission_id, { answers: [{ paper_question_id: sc.pq.judge, response: true }], submitted_at: '2000-01-01T00:00:00Z', auto: false }));
  assert.equal(r.status, 'pending_review');
  assert.equal(r.submit_type, 'manual');
  assert.equal(r.answers_accepted, true);
  assert.equal(r.submitted_at, clock.nowIso());
});

test('IT-ANS-06 重复交卷幂等：409/40904，返回原 SubmitResult，数据不变；交卷后保存/再进入均 40904', async () => {
  const s0 = h.ok(await h.api('GET', '/api/student/exams', { token: tokens[0] })).items.find((e) => e.id === sc.exam.id);
  const first = await submit(0, s0.submission_id, {});
  h.err(first, 409, 40904);
  clock.advance(5000);
  const second = h.err(await submit(0, s0.submission_id, { answers: [{ paper_question_id: sc.pq.single, response: 'B' }] }), 409, 40904);
  assert.equal(second.data.submitted_at, first.data.submitted_at);
  assert.equal(second.data.answers_accepted, false);
  h.err(await save(0, s0.submission_id, [{ paper_question_id: sc.pq.single, response: 'B' }]), 409, 40904);
  h.err(await start(0), 409, 40904);
});

test('IT-ANS-07 并发交卷：同一答卷 10 个并发请求仅 1 次成功，其余 40904', async () => {
  const s = h.ok(await start(1));
  h.ok(await save(1, s.submission_id, [{ paper_question_id: sc.pq.single, response: 'B' }]));
  const rs = await Promise.all(Array.from({ length: 10 }, () => submit(1, s.submission_id, { answers: [{ paper_question_id: sc.pq.judge, response: true }] })));
  const okCount = rs.filter((r) => r.status === 200 && r.code === 0).length;
  const dup = rs.filter((r) => r.status === 409 && r.code === 40904).length;
  assert.equal(okCount, 1);
  assert.equal(dup, 9);
  const subs = h.server.store.data.submissions.filter((x) => x.id === s.submission_id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].status, 'pending_review');
});

test('IT-ANS-08 并发开始作答：同一学生 5 个并发 start 只生成 1 份答卷', async () => {
  const rs = await Promise.all(Array.from({ length: 5 }, () => start(2)));
  assert.ok(rs.every((r) => r.code === 0));
  assert.equal(new Set(rs.map((r) => r.data.submission_id)).size, 1);
  const n = h.server.store.data.submissions.filter((x) => x.exam_id === sc.exam.id && x.student_id === h.server.store.data.users.find((u) => u.username === sc.stuNames[2]).id).length;
  assert.equal(n, 1);
});

test('IT-ANS-09 并发保存：多名学生并发保存互不干扰', async () => {
  const sheets = [];
  for (const i of [3, 4, 5]) sheets.push([i, h.ok(await start(i))]);
  const rs = await Promise.all(sheets.flatMap(([i, s]) => [
    save(i, s.submission_id, [{ paper_question_id: sc.pq.single, response: ['A', 'B', 'C'][i - 3] }]),
    save(i, s.submission_id, [{ paper_question_id: sc.pq.essay, response: `学生${i}的答案` }]),
  ]));
  assert.ok(rs.every((r) => r.code === 0));
  for (const [i] of sheets) {
    const again = h.ok(await start(i));
    const by = Object.fromEntries(again.answers.map((a) => [a.paper_question_id, a.response]));
    assert.equal(by[sc.pq.single], ['A', 'B', 'C'][i - 3]);
    assert.equal(by[sc.pq.essay], `学生${i}的答案`);
  }
});

test('IT-ANS-10 截止宽限：deadline+10s 内保存/交卷仍有效（auto=true → submit_type=auto）', async () => {
  const s = h.ok(await start(3));
  clock.setNow(Date.parse(s.deadline_at) + 9_000);
  h.ok(await save(3, s.submission_id, [{ paper_question_id: sc.pq.judge, response: false }]));
  h.err(await submit(3, s.submission_id, { auto: 'yes' }), 400, 40000);
  const r = h.ok(await submit(3, s.submission_id, { auto: true }));
  assert.equal(r.submit_type, 'auto');
  assert.equal(r.answers_accepted, true);
});

test('IT-ANS-11 超过截止+宽限：保存 40906 且答卷被强制交卷；交卷请求返回 forced、忽略本次答案', async () => {
  const s4 = h.ok(await start(4));
  const s5 = h.ok(await start(5));
  clock.setNow(Date.parse(s4.deadline_at) + 10_001);
  h.err(await save(4, s4.submission_id, [{ paper_question_id: sc.pq.single, response: 'B' }]), 409, 40906);
  const sub4 = h.server.store.data.submissions.find((x) => x.id === s4.submission_id);
  assert.equal(sub4.submit_type, 'forced');
  assert.equal(sub4.submitted_at, s4.deadline_at);
  const r5 = h.ok(await submit(5, s5.submission_id, { answers: [{ paper_question_id: sc.pq.single, response: 'B' }] }));
  assert.equal(r5.submit_type, 'forced');
  assert.equal(r5.answers_accepted, false);
  assert.equal(r5.submitted_at, s5.deadline_at);
  const ans = h.server.store.data.answers.find((a) => a.submission_id === s5.submission_id && a.paper_question_id === sc.pq.single);
  assert.equal(ans.response, 'C', '以已保存答案为准（IT-ANS-09 中保存的 C）');
});

test('IT-ANS-12 考试结束后未进入的学生 start → 409（已生成缺考记录，不能再作答）', async () => {
  clock.setNow(sc.endMs + 1000);
  const r = await start(6);
  assert.equal(r.status, 409);
  assert.ok([40905, 40904].includes(r.code), `code=${r.code}`);
  if (r.code === 40904) assert.equal(r.data.submit_type, 'absent');
});

test('IT-ANS-13 缺考学生考试结束后 start 应返回 40905“当前不在考试时间内”（设计文档 §8.1 状态表）', async () => {
  clock.setNow(sc.endMs + 2000);
  h.err(await start(7), 409, 40905);
});
