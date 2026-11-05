// 接口集成测试：发布考试（FR-EXAM-01）、考试管理（FR-EXAM-02）、学生考试列表（FR-EXAM-03）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, buildScenario } from './helpers/harness.mjs';

let h, sc;
const T0 = Date.parse('2026-11-05T03:00:00.000Z');
before(async () => {
  clock.setNow(T0);
  h = await startHarness();
  sc = await buildScenario(h, { students: 2 });
});
after(() => h.close());
const iso = (ms) => new Date(ms).toISOString();
const body = (o = {}) => ({ title: '考试X', paper_id: sc.paper.id, class_ids: [sc.cls.id], duration_minutes: 10, start_time: iso(clock.nowMs() + 60_000), end_time: iso(clock.nowMs() + 3600_000), ...o });

test('IT-EXAM-01 发布考试成功：not_started、默认及格线=总分×60%、应考人数=班级学生数、班级列表', async () => {
  const e = h.ok(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ title: '发布成功' }) }), 201);
  assert.equal(e.status, 'not_started');
  assert.equal(e.total_score, sc.paper.total_score);
  assert.equal(e.pass_score, Math.round(sc.paper.total_score * 0.6 * 10) / 10);
  assert.equal(e.counts.expected, 2);
  assert.deepEqual(e.classes.map((c) => c.id), [sc.cls.id]);
  const e2 = h.ok(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ pass_score: 15.5 }) }), 201);
  assert.equal(e2.pass_score, 15.5);
});

test('IT-EXAM-02 时间窗口校验：开始≤当前、结束≤开始、时长>窗口 → 40000 字段级', async () => {
  const now = clock.nowMs();
  const cases = [
    [{ start_time: iso(now), end_time: iso(now + 3600_000) }, 'start_time'],
    [{ start_time: iso(now - 1000), end_time: iso(now + 3600_000) }, 'start_time'],
    [{ start_time: iso(now + 60_000), end_time: iso(now + 60_000) }, 'end_time'],
    [{ start_time: iso(now + 60_000), end_time: iso(now + 30_000) }, 'end_time'],
    [{ start_time: iso(now + 60_000), end_time: iso(now + 60_000 + 5 * 60_000), duration_minutes: 6 }, 'duration_minutes'],
    [{ start_time: '2026/11/05 10:00' }, 'start_time'],
    [{ duration_minutes: 0 }, 'duration_minutes'],
    [{ pass_score: 99999 }, 'pass_score'],
    [{ class_ids: [] }, 'class_ids'],
    [{ title: '' }, 'title'],
  ];
  for (const [o, field] of cases) {
    const r = h.err(await h.api('POST', '/api/exams', { token: sc.tk, body: body(o) }), 400, 40000);
    assert.ok(r.data.errors.some((e) => e.field === field), `${field} ← ${JSON.stringify(r.data.errors)}`);
  }
  // 时长恰好等于窗口：允许
  h.ok(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ start_time: iso(now + 60_000), end_time: iso(now + 60_000 + 10 * 60_000), duration_minutes: 10 }) }), 201);
});

test('IT-EXAM-03 班级/试卷不存在 → 40400', async () => {
  h.err(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ class_ids: [99999] }) }), 404, 40400);
  h.err(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ paper_id: 99999 }) }), 404, 40400);
});

test('IT-EXAM-04 修改考试：未开始可改全部字段；进行中仅可延长 end_time（同步延长作答截止）；已结束 40902', async () => {
  const now = clock.nowMs();
  const e = h.ok(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ title: '待修改', start_time: iso(now + 60_000), end_time: iso(now + 60_000 + 10 * 60_000), duration_minutes: 10 }) }), 201);
  const u = h.ok(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { title: '已修改', description: '新说明', pass_score: 10 } }));
  assert.equal(u.title, '已修改');
  assert.equal(u.description, '新说明');
  assert.equal(u.pass_score, 10);
  clock.setNow(now + 2 * 60_000); // 进行中
  const s = await h.login(sc.stuNames[0], 'Abc12345');
  const sheet = h.ok(await h.api('POST', `/api/student/exams/${e.id}/start`, { token: s }));
  assert.equal(sheet.deadline_at, iso(now + 60_000 + 10 * 60_000), '截止被 end_time 截断（9 分钟后）');
  h.err(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { title: '进行中改名' } }), 409, 40902);
  h.err(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { end_time: iso(now + 5 * 60_000) } }), 400, 40000);
  const ext = h.ok(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { end_time: iso(now + 60 * 60_000) } }));
  assert.equal(ext.end_time, iso(now + 60 * 60_000));
  const again = h.ok(await h.api('POST', `/api/student/exams/${e.id}/start`, { token: s }));
  assert.equal(again.deadline_at, iso(now + 2 * 60_000 + 10 * 60_000), '延长后截止 = started + 10 分钟');
  h.err(await h.api('POST', `/api/exams/${e.id}/cancel`, { token: sc.tk }), 409, 40902);
  clock.setNow(now + 61 * 60_000);
  h.err(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { end_time: iso(now + 99 * 60_000) } }), 409, 40902);
  clock.setNow(T0);
});

test('IT-EXAM-05 取消考试：未开始可取消，学生不可见且 start 40400；不可再修改', async () => {
  const e = h.ok(await h.api('POST', '/api/exams', { token: sc.tk, body: body({ title: '将取消' }) }), 201);
  const c = h.ok(await h.api('POST', `/api/exams/${e.id}/cancel`, { token: sc.tk }));
  assert.equal(c.status, 'cancelled');
  assert.ok(c.cancelled_at);
  const s = await h.login(sc.stuNames[1], 'Abc12345');
  const list = h.ok(await h.api('GET', '/api/student/exams', { token: s }));
  assert.ok(!list.items.some((x) => x.id === e.id));
  clock.advance(2 * 60_000);
  h.err(await h.api('POST', `/api/student/exams/${e.id}/start`, { token: s }), 404, 40400);
  h.err(await h.api('PUT', `/api/exams/${e.id}`, { token: sc.tk, body: { title: 'x' } }), 409, 40902);
  clock.setNow(T0);
});

test('IT-EXAM-06 考试列表（状态筛选）与管理员只读查看', async () => {
  const all = h.ok(await h.api('GET', '/api/exams?page_size=100', { token: sc.tk }));
  assert.ok(all.total >= 4);
  const ns = h.ok(await h.api('GET', '/api/exams?status=not_started&page_size=100', { token: sc.tk }));
  assert.ok(ns.items.every((e) => e.status === 'not_started'));
  const cancelled = h.ok(await h.api('GET', '/api/exams?status=cancelled', { token: sc.tk }));
  assert.ok(cancelled.total >= 1);
  const adm = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}`, { token: sc.admin }));
  assert.equal(adm.id, sc.exam.id);
  h.err(await h.api('GET', '/api/exams?status=bad', { token: sc.tk }), 400, 40000);
});

test('IT-EXAM-07 学生考试列表：not_started → available → in_progress → finished；server_time 存在', async () => {
  const s = await h.login(sc.stuNames[1], 'Abc12345');
  const find = async () => h.ok(await h.api('GET', '/api/student/exams', { token: s })).items.find((x) => x.id === sc.exam.id);
  assert.equal((await find()).student_status, 'not_started');
  clock.setNow(sc.startMs + 1000);
  assert.equal((await find()).student_status, 'available');
  const sheet = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: s }));
  assert.equal((await find()).student_status, 'in_progress');
  h.ok(await h.api('POST', `/api/submissions/${sheet.submission_id}/submit`, { token: s, body: {} }));
  const f = await find();
  assert.equal(f.student_status, 'finished');
  assert.equal(f.submission_id, sheet.submission_id);
  const avail = h.ok(await h.api('GET', '/api/student/exams?status=finished', { token: s }));
  assert.ok(avail.items.every((x) => x.student_status === 'finished'));
  const one = h.ok(await h.api('GET', `/api/student/exams/${sc.exam.id}`, { token: s }));
  assert.ok(one.server_time);
  // 监控：一人已交、一人未开始
  const mon = h.ok(await h.api('GET', `/api/exams/${sc.exam.id}/monitor`, { token: sc.tk }));
  assert.deepEqual(mon.items.map((i) => i.state).sort(), ['not_started', 'submitted']);
  assert.equal(mon.status, 'ongoing');
});
