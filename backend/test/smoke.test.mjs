// 冒烟测试：临时 DATA_DIR 启动服务，走通 admin→teacher→student→阅卷→发布→统计 完整闭环
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { start } from '../server.mjs';
import * as clock from '../src/core/clock.mjs';

let server;
let dataDir;
let base;

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json() : { text: await res.text() };
  return { status: res.status, ...json };
}
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r));
  assert.equal(r.code, 0, JSON.stringify(r));
  return r.data;
};
const login = async (username, password) => ok(await api('POST', '/api/auth/login', { body: { username, password } })).token;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-smoke-'));
  server = await start({ port: 0, host: '127.0.0.1', dataDir, scheduler: false });
  base = server.url;
});

after(async () => {
  clock.reset();
  await server.stop();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('种子数据：四个账号可登录，学生可见进行中的示例考试', async () => {
  const admin = await login('admin', 'admin123');
  const me = ok(await api('GET', '/api/auth/me', { token: admin }));
  assert.equal(me.role, 'admin');
  assert.equal(me.password_hash, undefined);
  await login('teacher1', 'teacher123');
  await login('student2', 'student123');
  const s1 = await login('student1', 'student123');
  const list = ok(await api('GET', '/api/student/exams', { token: s1 }));
  assert.ok(list.server_time);
  assert.ok(list.items.some((e) => e.student_status === 'available'), '示例考试应为可参加');
  const bad = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong1' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.code, 40101);
  assert.equal((await api('GET', '/api/users', { token: s1 })).code, 40300);
  assert.equal((await api('GET', '/api/nope', { token: s1 })).code, 40400);
  assert.equal((await api('GET', '/api/users/abc', { token: admin })).code, 40000);
});

test('完整闭环：建班建人 → 建题 → 组卷 → 发布 → 作答交卷 → 阅卷 → 发布成绩 → 统计', async () => {
  const t0 = Date.now();
  clock.setNow(t0);
  // ---- admin
  const admin = await login('admin', 'admin123');
  const cls = ok(await api('POST', '/api/classes', { token: admin, body: { name: '软工2201', grade: '2022', major: '软件工程' } }), 201);
  assert.equal(cls.student_count, 0);
  const dup = await api('POST', '/api/classes', { token: admin, body: { name: '软工2201' } });
  assert.equal(dup.code, 40900);
  const stuA = ok(await api('POST', '/api/users', { token: admin, body: { username: 'stu_a', name: '学生甲', role: 'student', class_id: cls.id, password: 'Abc12345' } }), 201);
  ok(await api('POST', '/api/users', { token: admin, body: { username: 'stu_b', name: '学生乙', role: 'student', class_id: cls.id } }), 201);
  assert.equal(stuA.class_name, '软工2201');
  const teachers = ok(await api('GET', '/api/users?role=teacher', { token: admin }));
  const t1 = teachers.items.find((u) => u.username === 'teacher1');
  const members = ok(await api('PUT', `/api/classes/${cls.id}/teachers`, { token: admin, body: { teacher_ids: [t1.id] } }));
  assert.equal(members.students.length, 2);
  assert.equal(members.teachers[0].id, t1.id);

  // ---- teacher：建题
  const tk = await login('teacher1', 'teacher123');
  const mk = async (body) => ok(await api('POST', '/api/questions', { token: tk, body }), 201);
  const qs = await mk({ type: 'single', stem: '1+1=?', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], answer: 'B', difficulty: 'easy', score: 2, tags: ['冒烟'] });
  const qm = await mk({ type: 'multiple', stem: '偶数有？', options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }, { key: 'C', text: '4' }], answer: ['C', 'A'], difficulty: 'medium', score: 4 });
  const qe = await mk({ type: 'essay', stem: '谈谈你对测试的理解', answer: '参考答案', difficulty: 'hard', score: 10 });
  const qj = await mk({ type: 'judge', stem: '地球是圆的', answer: true, difficulty: 'easy', score: 2 });
  const qf = await mk({ type: 'fill', stem: '中国首都是 ___，建国于 ___ 年', answer: [['北京', 'Beijing'], ['1949']], difficulty: 'easy', score: 5 });
  assert.deepEqual(qm.answer, ['A', 'C']);
  assert.equal(qf.blank_count, 2);
  const badQ = await api('POST', '/api/questions', { token: tk, body: { type: 'single', stem: 'x', options: [{ key: 'B', text: 'a' }], answer: 'A', difficulty: 'easy', score: 1 } });
  assert.equal(badQ.code, 40000);
  assert.ok(badQ.data.errors.length > 0);
  const page = ok(await api('GET', '/api/questions?tags=冒烟', { token: tk }));
  assert.equal(page.total, 1);
  assert.equal(page.summary.by_type.single, 1);

  // ---- 组卷（乱序提交，服务端按题型排序）
  const paper = ok(await api('POST', '/api/papers', {
    token: tk,
    body: { title: '冒烟试卷', items: [qe, qf, qj, qm, qs].map((q) => ({ question_id: q.id, score: q.score * 2 })) },
  }), 201);
  assert.deepEqual(paper.questions.map((q) => q.type), ['single', 'multiple', 'judge', 'fill', 'essay']);
  assert.deepEqual(paper.questions.map((q) => q.seq), [1, 2, 3, 4, 5]);
  assert.equal(paper.total_score, 46);
  assert.equal(paper.locked, false);
  const draft = ok(await api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [{ type: 'single', count: 1, score: 5 }] } }));
  assert.equal(draft.items.length, 1);
  const short = await api('POST', '/api/papers/random/generate', { token: tk, body: { rules: [{ type: 'essay', count: 99, score: 5 }] } });
  assert.equal(short.status, 422);
  assert.equal(short.code, 42200);

  // ---- 发布考试
  const st = new Date(t0 + 60_000).toISOString();
  const et = new Date(t0 + 20 * 60_000).toISOString();
  const exam = ok(await api('POST', '/api/exams', {
    token: tk, body: { title: '冒烟考试', paper_id: paper.id, start_time: st, end_time: et, duration_minutes: 10, class_ids: [cls.id] },
  }), 201);
  assert.equal(exam.status, 'not_started');
  assert.equal(exam.pass_score, 27.6);
  assert.equal(exam.counts.expected, 2);
  assert.equal((await api('PUT', `/api/papers/${paper.id}`, { token: tk, body: { title: 'x', items: [{ question_id: qs.id, score: 1 }] } })).code, 40903);

  // ---- 学生作答
  const sa = await login('stu_a', 'Abc12345');
  const early = await api('POST', `/api/student/exams/${exam.id}/start`, { token: sa });
  assert.equal(early.code, 40905);
  clock.setNow(t0 + 2 * 60_000); // 考试进行中
  const list = ok(await api('GET', '/api/student/exams?status=available', { token: sa }));
  assert.ok(list.items.some((e) => e.id === exam.id && e.student_status === 'available'));
  const sheet = ok(await api('POST', `/api/student/exams/${exam.id}/start`, { token: sa }));
  assert.equal(sheet.questions.length, 5);
  for (const q of sheet.questions) {
    assert.equal(q.answer, undefined, '作答视图不得包含答案');
    assert.equal(q.analysis, undefined);
  }
  assert.ok(sheet.answers.every((a) => a.response === null));
  const pq = Object.fromEntries(sheet.questions.map((q) => [q.type, q.id]));
  const again = ok(await api('POST', `/api/student/exams/${exam.id}/start`, { token: sa }));
  assert.equal(again.started_at, sheet.started_at, '再次进入不重置开始时间');
  const saved = ok(await api('PUT', `/api/submissions/${sheet.submission_id}/answers`, {
    token: sa, body: { answers: [{ paper_question_id: pq.single, response: 'B' }, { paper_question_id: pq.multiple, response: ['C', 'A'] }] },
  }));
  assert.ok(saved.saved_at);
  const badShape = await api('PUT', `/api/submissions/${sheet.submission_id}/answers`, { token: sa, body: { answers: [{ paper_question_id: pq.judge, response: 'yes' }] } });
  assert.equal(badShape.code, 40000);
  // 另一名学生不能操作他人答卷
  const s1 = await login('student1', 'student123');
  assert.equal((await api('PUT', `/api/submissions/${sheet.submission_id}/answers`, { token: s1, body: { answers: [{ paper_question_id: pq.single, response: 'A' }] } })).code, 40301);
  assert.equal((await api('POST', `/api/student/exams/${exam.id}/start`, { token: s1 })).code, 40301);

  const submitted = ok(await api('POST', `/api/submissions/${sheet.submission_id}/submit`, {
    token: sa,
    body: { answers: [{ paper_question_id: pq.judge, response: true }, { paper_question_id: pq.fill, response: [' beijing ', '1950'] }, { paper_question_id: pq.essay, response: '测试很重要' }] },
  }));
  assert.equal(submitted.status, 'pending_review');
  assert.equal(submitted.submit_type, 'manual');
  assert.equal(submitted.answers_accepted, true);
  // 幂等：重复交卷 409/40904，数据不变
  const dupSubmit = await api('POST', `/api/submissions/${sheet.submission_id}/submit`, { token: sa, body: {} });
  assert.equal(dupSubmit.status, 409);
  assert.equal(dupSubmit.code, 40904);
  assert.equal(dupSubmit.data.submitted_at, submitted.submitted_at);
  assert.equal((await api('PUT', `/api/submissions/${sheet.submission_id}/answers`, { token: sa, body: { answers: [{ paper_question_id: pq.single, response: 'A' }] } })).code, 40904);

  // ---- 教师阅卷（客观：单选4 + 多选8 + 判断4 + 填空第1空5 = 21）
  const ov = ok(await api('GET', `/api/exams/${exam.id}/grading`, { token: tk }));
  assert.equal(ov.progress.total, 1);
  assert.equal(ov.progress.pending, 1);
  assert.equal(ov.submissions[0].objective_score, 21);
  assert.equal(ov.essay_questions[0].paper_question_id, pq.essay);
  const byQ = ok(await api('GET', `/api/exams/${exam.id}/grading/questions/${pq.essay}`, { token: tk }));
  assert.equal(byQ.items[0].response, '测试很重要');
  assert.equal(byQ.question.reference_answer, '参考答案');
  const tooHigh = await api('PUT', `/api/submissions/${sheet.submission_id}/grades`, { token: tk, body: { grades: [{ paper_question_id: pq.essay, score: 99 }] } });
  assert.equal(tooHigh.code, 40000);
  const gr = ok(await api('PUT', `/api/submissions/${sheet.submission_id}/grades`, { token: tk, body: { grades: [{ paper_question_id: pq.essay, score: 15.5, comment: '不错' }] } }));
  assert.equal(gr.status, 'graded');
  assert.equal(gr.total_score, 36.5);
  assert.equal(gr.essay_graded, 1);

  // ---- 发布成绩：考试未结束 40902；结束后成功（stu_b 生成缺考）
  assert.equal((await api('POST', `/api/exams/${exam.id}/publish-results`, { token: tk, body: {} })).code, 40902);
  const pending = ok(await api('GET', `/api/student/results/${exam.id}`, { token: sa }));
  assert.equal(pending.submission.total_score, null, '发布前学生看不到分数');
  assert.deepEqual(pending.questions, []);
  clock.setNow(t0 + 21 * 60_000);
  const mon = ok(await api('GET', `/api/exams/${exam.id}/monitor`, { token: tk }));
  assert.deepEqual(mon.items.map((i) => i.state).sort(), ['absent', 'submitted']);
  const pub = ok(await api('POST', `/api/exams/${exam.id}/publish-results`, { token: tk, body: { allow_review: true } }));
  assert.equal(pub.results_published, true);
  assert.equal(pub.status, 'ended');
  assert.equal(pub.counts.absent, 1);

  // ---- 学生查成绩
  const res = ok(await api('GET', `/api/student/results/${exam.id}`, { token: sa }));
  assert.equal(res.submission.total_score, 36.5);
  assert.equal(res.submission.passed, true);
  assert.equal(res.questions.length, 5);
  assert.deepEqual(res.questions.find((q) => q.type === 'multiple').correct_answer, ['A', 'C']);
  const myList = ok(await api('GET', '/api/student/results', { token: sa }));
  assert.equal(myList.items[0].total_score, 36.5);

  // ---- 统计（教师与管理员只读）
  const sheetData = ok(await api('GET', `/api/exams/${exam.id}/scores`, { token: tk }));
  assert.equal(sheetData.items.length, 2);
  assert.equal(sheetData.items[0].rank, 1);
  assert.equal(sheetData.items[0].total_score, 36.5);
  const sum = ok(await api('GET', `/api/exams/${exam.id}/stats/summary`, { token: admin }));
  assert.equal(sum.expected_count, 2);
  assert.equal(sum.actual_count, 1);
  assert.equal(sum.absent_count, 1);
  assert.equal(sum.average_score, 36.5);
  assert.equal(sum.pass_rate, 100);
  assert.equal(sum.by_class.length, 1);
  const dist = ok(await api('GET', `/api/exams/${exam.id}/stats/distribution`, { token: tk }));
  assert.equal(dist.buckets.length, 5);
  assert.equal(dist.buckets[2].count, 1); // 36.5/46 = 79.3% → [70%,80%)
  const qstat = ok(await api('GET', `/api/exams/${exam.id}/stats/questions?sort=rate_asc`, { token: tk }));
  assert.equal(qstat.actual_count, 1);
  assert.equal(qstat.items.length, 5);
  assert.equal(qstat.items.find((i) => i.type === 'essay').correct_rate, null);
  const csv = await fetch(`${base}/api/exams/${exam.id}/scores/export`, { headers: { Authorization: `Bearer ${tk}` } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const overview = ok(await api('GET', '/api/admin/overview', { token: admin }));
  assert.ok(overview.users.total >= 6);
});

test('数据已原子落盘到 DATA_DIR/db.json', async () => {
  await server.store.flush();
  const db = JSON.parse(await fs.readFile(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(db.users.length >= 6);
  assert.ok(db.users.every((u) => u.password_hash && u.password_salt && !u.password));
  assert.ok(db.submissions.some((s) => s.submit_type === 'absent'));
});
