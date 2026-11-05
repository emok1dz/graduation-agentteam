// 接口集成测试：到时强制交卷与缺考（FR-ANS-05、FR-GRADE-01，假时钟 + sweepAll / 定时器）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, buildScenario } from './helpers/harness.mjs';

let h, sc, tks;
const T0 = Date.parse('2026-11-05T05:00:00.000Z');
before(async () => {
  clock.setNow(T0);
  h = await startHarness();
  sc = await buildScenario(h, { students: 4, withEssay: false, durationMinutes: 10, windowMs: 30 * 60_000 });
  tks = [];
  for (const u of sc.stuNames) tks.push(await h.login(u, 'Abc12345'));
});
after(() => h.close());
const subOf = (id) => h.server.store.data.submissions.find((s) => s.id === id);

test('IT-SWEEP-01 学生离线超时：sweepAll 以已保存答案强制交卷（forced，submitted_at=deadline_at）并自动阅卷', async () => {
  clock.setNow(sc.startMs + 1000);
  const s = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: tks[0] }));
  h.ok(await h.api('PUT', `/api/submissions/${s.submission_id}/answers`, { token: tks[0], body: { answers: [
    { paper_question_id: sc.pq.single, response: 'B' }, { paper_question_id: sc.pq.multiple, response: ['A'] },
    { paper_question_id: sc.pq.fill, response: ['beijing', '1949'] },
  ] } }));
  // 截止 + 宽限之内：不处理
  clock.setNow(Date.parse(s.deadline_at) + 10_000);
  await h.server.services.answer.sweepAll(clock.now());
  assert.equal(subOf(s.submission_id).status, 'in_progress');
  clock.setNow(Date.parse(s.deadline_at) + 10_001);
  const n = await h.server.services.answer.sweepAll(clock.now());
  assert.equal(n, 1);
  const sub = subOf(s.submission_id);
  assert.equal(sub.submit_type, 'forced');
  assert.equal(sub.submitted_at, s.deadline_at);
  assert.equal(sub.status, 'graded', '无简答题直接 graded');
  // 手算：单选 2 + 多选少选 0 + 判断未答 0 + 填空 4 = 6
  assert.equal(sub.objective_score, 6);
  assert.equal(sub.total_score, 6);
  const st = h.ok(await h.api('GET', '/api/student/exams', { token: tks[0] })).items.find((e) => e.id === sc.exam.id);
  assert.equal(st.student_status, 'finished');
});

test('IT-SWEEP-02 未经 scheduler，访问监控接口时也会懒触发强制交卷', async () => {
  clock.setNow(sc.startMs + 5 * 60_000);
  const s = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: tks[1] }));
  clock.setNow(Date.parse(s.deadline_at) + 60_000);
  const mon = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/monitor`, { token: sc.tk }));
  const row = mon.items.find((i) => i.submission_id === s.submission_id);
  assert.equal(row.state, 'submitted');
  assert.equal(row.submit_type, 'forced');
  assert.equal(subOf(s.submission_id).total_score, 0, '全部未答 0 分');
});

test('IT-SWEEP-03 已超时的作答中答卷再次 start → 先强制交卷再 40904', async () => {
  clock.setNow(sc.startMs + 10 * 60_000);
  const s = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: tks[2] }));
  clock.setNow(Date.parse(s.deadline_at) + 11_000);
  // 直接操作 start，不经 sweep 的前置条件（needsSweep 也会命中，这里验证最终结果）
  const r = h.err(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: tks[2] }), 409, 40904);
  assert.equal(r.data.submit_type, 'forced');
});

test('IT-SWEEP-04 考试结束：为未参加学生生成缺考记录（absent，0 分，graded）；重复 sweep 不重复生成', async () => {
  clock.setNow(sc.endMs + 1);
  await h.server.services.answer.sweepAll(clock.now());
  const subs = h.server.store.data.submissions.filter((s) => s.exam_id === sc.exam.id);
  assert.equal(subs.length, 4);
  const absent = subs.filter((s) => s.submit_type === 'absent');
  assert.equal(absent.length, 1);
  assert.deepEqual([absent[0].status, absent[0].total_score, absent[0].submitted_at], ['graded', 0, sc.exam.end_time]);
  assert.equal(h.server.store.data.exams.find((e) => e.id === sc.exam.id).absent_generated, true);
  await h.server.services.answer.sweepAll(clock.now());
  assert.equal(h.server.store.data.submissions.filter((s) => s.exam_id === sc.exam.id).length, 4);
  const st = h.ok(await h.api('GET', '/api/student/exams', { token: await h.login(sc.stuNames[3], 'Abc12345') })).items.find((e) => e.id === sc.exam.id);
  assert.equal(st.student_status, 'missed');
  const exam = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}`, { token: sc.tk }));
  assert.equal(exam.status, 'ended');
  assert.deepEqual([exam.counts.expected, exam.counts.submitted, exam.counts.absent], [4, 3, 1]);
});

test('IT-SWEEP-05 scheduler 定时器真实触发：开启 scheduler（间隔 100ms），无请求时自动强制交卷', async () => {
  clock.setNow(T0);
  const h2 = await startHarness({ config: { SWEEP_INTERVAL_MS: 100 } });
  try {
    // 用 scheduler: false 的 harness 构造数据后再手动启动 scheduler
    const sc2 = await buildScenario(h2, { students: 1, withEssay: false, durationMinutes: 1, windowMs: 5 * 60_000 });
    clock.setNow(sc2.startMs + 1000);
    const tk = await h2.login(sc2.stuNames[0], 'Abc12345');
    const s = h2.ok(await h2.api('POST', `/api/student/exams/${sc2.exam.id}/start`, { token: tk }));
    clock.setNow(Date.parse(s.deadline_at) + 20_000);
    h2.server.services.scheduler.start({ sweepIntervalMs: 100, cleanIntervalMs: 60_000 });
    const sub = () => h2.server.store.data.submissions.find((x) => x.id === s.submission_id);
    const t = Date.now();
    while (sub().status === 'in_progress' && Date.now() - t < 3000) await new Promise((r) => setTimeout(r, 50));
    assert.equal(sub().submit_type, 'forced');
    h2.server.services.scheduler.stop();
  } finally {
    await h2.close();
  }
});
