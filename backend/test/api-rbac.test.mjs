// 接口集成测试：RBAC 越权（NFR-06）——角色不符 40300、资源不属于本人 40301
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, SEED, buildScenario, Q } from './helpers/harness.mjs';

let h, sc, stu, t2;
before(async () => {
  clock.setNow(Date.parse('2026-11-05T01:00:00.000Z'));
  h = await startHarness();
  sc = await buildScenario(h, { students: 1 });
  stu = await h.login(...SEED.student1);
  t2 = await h.login('teacher2', 'Teach2pass');
});
after(() => h.close());

test('IT-RBAC-01 学生调用教师/管理员接口 → 403/40300', async () => {
  const calls = [
    ['GET', '/api/questions'], ['POST', '/api/questions', Q.single()], ['GET', '/api/papers'], ['POST', '/api/papers', { title: 'x', items: [] }],
    ['POST', '/api/exams', {}], ['GET', '/api/exams'], [`GET`, `/api/exams/${sc.exam.id}/grading`],
    ['POST', `/api/exams/${sc.exam.id}/publish-results`, {}], ['GET', `/api/exams/${sc.exam.id}/scores`],
    ['GET', '/api/users'], ['POST', '/api/classes', { name: 'x' }], ['GET', '/api/admin/overview'], ['GET', '/api/tags'],
    ['PUT', '/api/submissions/1/grades', { grades: [] }], ['GET', '/api/submissions/1'],
  ];
  for (const [m, u, body] of calls) {
    const r = await h.api(m, u, { token: stu, body });
    assert.equal(r.status, 403, `${m} ${u}`);
    assert.equal(r.code, 40300, `${m} ${u}`);
  }
});

test('IT-RBAC-02 教师调用管理员/学生接口 → 40300；管理员调用教师写接口 → 40300', async () => {
  for (const [m, u] of [['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/admin/overview'], ['GET', '/api/student/exams'], ['POST', `/api/student/exams/${sc.exam.id}/start`]]) {
    h.err(await h.api(m, u, { token: sc.tk, body: m === 'POST' ? {} : undefined }), 403, 40300);
  }
  for (const [m, u] of [['POST', '/api/questions'], ['POST', '/api/exams'], ['GET', '/api/questions'], ['PUT', '/api/submissions/1/grades']]) {
    h.err(await h.api(m, u, { token: sc.admin, body: m === 'GET' ? undefined : {} }), 403, 40300);
  }
});

test('IT-RBAC-03 教师操作他人题目/试卷/考试 → 40301（存在但不属于）、不存在 → 40400', async () => {
  const qid = sc.qs.single.id;
  h.err(await h.api('GET', `/api/questions/${qid}`, { token: t2 }), 403, 40301);
  h.err(await h.api('PUT', `/api/questions/${qid}`, { token: t2, body: Q.single() }), 403, 40301);
  h.err(await h.api('DELETE', `/api/questions/${qid}`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', `/api/papers/${sc.paper.id}`, { token: t2 }), 403, 40301);
  h.err(await h.api('DELETE', `/api/papers/${sc.paper.id}`, { token: t2 }), 403, 40301);
  h.err(await h.api('POST', `/api/papers/${sc.paper.id}/copy`, { token: t2, body: {} }), 403, 40301);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}`, { token: t2 }), 403, 40301);
  h.err(await h.api('POST', `/api/exams/${sc.exam.id}/cancel`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/monitor`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/grading`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/scores`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', `/api/exams/${sc.exam.id}/stats/summary`, { token: t2 }), 403, 40301);
  h.err(await h.api('GET', '/api/questions/99999', { token: t2 }), 404, 40400);
  // 他人列表不可见
  const list = h.ok(await h.api('GET', '/api/questions', { token: t2 }));
  assert.equal(list.total, 0);
});

test('IT-RBAC-04 教师组卷引用他人题目 → 40301；向非任课班级发布考试 → 40301', async () => {
  h.err(await h.api('POST', '/api/papers', { token: t2, body: { title: '偷题', items: [{ question_id: sc.qs.single.id, score: 2 }] } }), 403, 40301);
  const q = h.ok(await h.api('POST', '/api/questions', { token: t2, body: Q.judge() }), 201);
  const p = h.ok(await h.api('POST', '/api/papers', { token: t2, body: { title: 'T2卷', items: [{ question_id: q.id, score: 2 }] } }), 201);
  const now = clock.nowMs();
  h.err(await h.api('POST', '/api/exams', { token: t2, body: { title: 'x', paper_id: p.id, class_ids: [sc.cls.id], duration_minutes: 5, start_time: new Date(now + 60_000).toISOString(), end_time: new Date(now + 600_000).toISOString() } }), 403, 40301);
  // teacher1 用 teacher2 的试卷发布 → 40301
  h.err(await h.api('POST', '/api/exams', { token: sc.tk, body: { title: 'x', paper_id: p.id, class_ids: [sc.cls.id], duration_minutes: 5, start_time: new Date(now + 60_000).toISOString(), end_time: new Date(now + 600_000).toISOString() } }), 403, 40301);
});

test('IT-RBAC-05 学生访问非本班考试 → 40301；查看他班班级信息 → 40301', async () => {
  h.err(await h.api('GET', `/api/student/exams/${sc.exam.id}`, { token: stu }), 403, 40301);
  h.err(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: stu }), 403, 40301);
  h.err(await h.api('GET', `/api/classes/${sc.cls.id}`, { token: stu }), 403, 40301);
  h.err(await h.api('GET', `/api/classes/${sc.cls.id}/members`, { token: t2 }), 403, 40301);
});

test('IT-RBAC-06 学生操作他人答卷 → 40301；教师批改他人考试答卷 → 40301', async () => {
  clock.setNow(sc.startMs + 1000);
  const s = await h.login(sc.stuNames[0], 'Abc12345');
  const sheet = h.ok(await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: s }));
  const stu2 = await h.login(...SEED.student2);
  h.err(await h.api('PUT', `/api/submissions/${sheet.submission_id}/answers`, { token: stu2, body: { answers: [{ paper_question_id: sc.pq.single, response: 'A' }] } }), 403, 40301);
  h.err(await h.api('POST', `/api/submissions/${sheet.submission_id}/submit`, { token: stu2, body: {} }), 403, 40301);
  h.ok(await h.api('POST', `/api/submissions/${sheet.submission_id}/submit`, { token: s, body: {} }));
  h.err(await h.api('PUT', `/api/submissions/${sheet.submission_id}/grades`, { token: t2, body: { grades: [{ paper_question_id: sc.pq.essay, score: 1 }] } }), 403, 40301);
  h.err(await h.api('GET', `/api/submissions/${sheet.submission_id}`, { token: t2 }), 403, 40301);
  // 管理员可只读查看答卷详情
  const d = h.ok(await h.api('GET', `/api/submissions/${sheet.submission_id}`, { token: sc.admin }));
  assert.equal(d.submission.id, sheet.submission_id);
});

test('IT-RBAC-07 路径参数非法 40000（鉴权之后）、未知路由 40400、方法不允许 40500', async () => {
  h.err(await h.api('GET', '/api/questions/abc'), 401, 40100);
  h.err(await h.api('GET', '/api/questions/abc', { token: sc.tk }), 400, 40000);
  h.err(await h.api('GET', '/api/nothing', { token: sc.tk }), 404, 40400);
  h.err(await h.api('GET', '/api/questions/import', { token: sc.tk }), 405, 40500);
});
