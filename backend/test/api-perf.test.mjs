// 非功能测试：性能（NFR-01 接口响应时间、NFR-02 并发答题）
// 数据规模按 NFR-01：1000 用户、2000 题、100 场考试、5000 份答卷（直接经仓储批量写入）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, SEED } from './helpers/harness.mjs';
import { hashPassword } from '../src/domain/password.mjs';

let h, ctx = {};
const T0 = Date.parse('2026-11-05T09:00:00.000Z');
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const fmt = (arr) => `n=${arr.length} avg=${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)}ms p50=${pct(arr, 50).toFixed(1)}ms p95=${pct(arr, 95).toFixed(1)}ms max=${Math.max(...arr).toFixed(1)}ms`;
async function timed(fn) {
  const t = performance.now();
  const r = await fn();
  return [performance.now() - t, r];
}

before(async () => {
  clock.setNow(T0);
  h = await startHarness();
  const { hash, salt } = await hashPassword('Abc12345');
  const repos = h.server.repos;
  const tStart = performance.now();
  await repos.transaction(async (tx) => {
    const t1 = await tx.users.findByUsername('teacher1');
    const classes = [];
    for (let c = 0; c < 10; c++) {
      const cls = await tx.classes.insert({ name: `规模班${c}`, grade: '2022', major: '测试', remark: '' });
      await tx.classes.setTeachers(cls.id, [t1.id]);
      classes.push(cls);
    }
    const conc = await tx.classes.insert({ name: '并发班', grade: '2022', major: '测试', remark: '' });
    await tx.classes.setTeachers(conc.id, [t1.id]);
    ctx.concClass = conc.id;
    const stuBy = new Map(classes.map((c) => [c.id, []]));
    // 用户：4 种子 + 776 规模学生 + 200 并发学生 + 20 教师 = 1000
    for (let i = 0; i < 776; i++) {
      const cls = classes[i % 10];
      const u = await tx.users.insert({ username: `p${i}`, name: `规模${i}`, role: 'student', class_id: cls.id, status: 'active', password_hash: hash, password_salt: salt, failed_login_count: 0, locked_until: null });
      stuBy.get(cls.id).push(u);
    }
    ctx.concStudents = [];
    for (let i = 0; i < 200; i++) {
      await tx.users.insert({ username: `c${i}`, name: `并发${i}`, role: 'student', class_id: conc.id, status: 'active', password_hash: hash, password_salt: salt, failed_login_count: 0, locked_until: null });
      ctx.concStudents.push(`c${i}`);
    }
    for (let i = 0; i < 20; i++) await tx.users.insert({ username: `pt${i}`, name: `教师${i}`, role: 'teacher', class_id: null, status: 'active', password_hash: hash, password_salt: salt, failed_login_count: 0, locked_until: null });
    // 题目：已有 10 道种子题，补到 2000
    const qs = [];
    for (let i = 0; i < 1990; i++) {
      const type = ['single', 'multiple', 'judge', 'fill', 'essay'][i % 5];
      const base = { teacher_id: t1.id, type, stem: `规模题目 ${i} ___`, difficulty: ['easy', 'medium', 'hard'][i % 3], analysis: '', deleted_at: null, score: 2 };
      const spec = {
        single: { options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: 'A', blank_count: 0 },
        multiple: { options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }], answer: ['A', 'B'], blank_count: 0 },
        judge: { options: [], answer: true, blank_count: 0 },
        fill: { options: [], answer: [['x']], blank_count: 1 },
        essay: { options: [], answer: '参考', blank_count: 0 },
      }[type];
      qs.push(await tx.questions.insert({ ...base, ...spec }));
    }
    // 试卷：5 道客观题（各 2 分，满分 10）
    const pick = qs.filter((q) => q.type !== 'essay').slice(0, 5);
    const paper = await tx.papers.insert({ teacher_id: t1.id, title: '规模试卷', description: '', total_score: 10, question_count: 5 });
    const pqs = [];
    let seq = 0;
    for (const q of pick) pqs.push(await tx.papers.insertQuestion({ paper_id: paper.id, question_id: q.id, seq: ++seq, type: q.type, stem: q.stem, options: q.options, answer: q.answer, analysis: '', difficulty: q.difficulty, blank_count: q.blank_count, tags: [], score: 2 }));
    ctx.pqs = pqs;
    // 100 场已结束考试 × 50 份答卷 = 5000
    ctx.examIds = [];
    for (let e = 0; e < 100; e++) {
      const cls = classes[e % 10];
      const exam = await tx.exams.insert({
        teacher_id: t1.id, paper_id: paper.id, title: `规模考试${e}`, description: '', start_time: new Date(T0 - 86400_000 * 2).toISOString(),
        end_time: new Date(T0 - 86400_000).toISOString(), duration_minutes: 60, pass_score: 6, shuffle_options: false, cancelled_at: null,
        results_published: true, results_published_at: new Date(T0 - 3600_000).toISOString(), allow_review: true, absent_generated: true,
      });
      await tx.exams.setClasses(exam.id, [cls.id]);
      ctx.examIds.push(exam.id);
      const studs = stuBy.get(cls.id).slice(0, 50);
      for (const [k, u] of studs.entries()) {
        const correct = k % 6; // 0..5 题答对
        const sub = await tx.submissions.insert({
          exam_id: exam.id, student_id: u.id, class_id: cls.id, status: 'graded', submit_type: 'manual', started_at: new Date(T0 - 86400_000 * 2 + 1000).toISOString(),
          deadline_at: new Date(T0 - 86400_000 * 2 + 3600_000).toISOString(), submitted_at: new Date(T0 - 86400_000 * 2 + 1800_000).toISOString(), last_saved_at: null,
          objective_score: correct * 2, subjective_score: 0, total_score: correct * 2,
        });
        for (const [qi, pq] of pqs.entries()) {
          await tx.submissions.insertAnswer({ submission_id: sub.id, paper_question_id: pq.id, response: qi < correct ? pq.answer : null, score: qi < correct ? 2 : 0, is_correct: qi < correct, comment: null, graded_by: null, graded_at: null });
        }
      }
    }
    // 并发答题用：进行中考试
    const live = await tx.exams.insert({
      teacher_id: t1.id, paper_id: paper.id, title: '并发考试', description: '', start_time: new Date(T0 - 60_000).toISOString(),
      end_time: new Date(T0 + 3600_000).toISOString(), duration_minutes: 60, pass_score: 6, shuffle_options: false, cancelled_at: null,
      results_published: false, results_published_at: null, allow_review: true, absent_generated: false,
    });
    await tx.exams.setClasses(live.id, [conc.id]);
    ctx.liveExam = live.id;
  });
  const d = h.server.store.data;
  ctx.scale = { users: d.users.length, questions: d.questions.length, exams: d.exams.length, submissions: d.submissions.length, answers: d.answers.length, buildMs: Math.round(performance.now() - tStart) };
  ctx.tk = await h.login(...SEED.teacher1);
});
after(() => h.close());

test('NFR-PERF-00 数据规模达到 NFR-01 要求', (t) => {
  t.diagnostic(`规模 ${JSON.stringify(ctx.scale)}`);
  assert.ok(ctx.scale.users >= 1000 && ctx.scale.questions >= 2000 && ctx.scale.exams >= 100 && ctx.scale.submissions >= 5000);
});

test('NFR-PERF-01 普通查询接口 100 次平均 ≤ 300ms（题库列表 / 考试列表 / 试卷列表）', async (t) => {
  for (const url of ['/api/questions?page=1&page_size=20', '/api/questions?type=single&keyword=%E8%A7%84%E6%A8%A1&page=3', '/api/exams?page=1&page_size=20', '/api/papers']) {
    const ts = [];
    for (let i = 0; i < 100; i++) {
      const [ms, r] = await timed(() => h.api('GET', url, { token: ctx.tk }));
      assert.equal(r.code, 0);
      ts.push(ms);
    }
    t.diagnostic(`GET ${url} ${fmt(ts)}`);
    assert.ok(ts.reduce((a, b) => a + b, 0) / ts.length <= 300, url);
  }
});

test('NFR-PERF-02 统计类接口 100 次平均 ≤ 1s（成绩单 / 概要 / 分布 / 每题分析）', async (t) => {
  const id = ctx.examIds[0];
  for (const url of [`/api/exams/${id}/scores`, `/api/exams/${id}/stats/summary`, `/api/exams/${id}/stats/distribution`, `/api/exams/${id}/stats/questions`]) {
    const ts = [];
    for (let i = 0; i < 100; i++) {
      const [ms, r] = await timed(() => h.api('GET', url, { token: ctx.tk }));
      assert.equal(r.code, 0);
      ts.push(ms);
    }
    t.diagnostic(`GET ${url.replace(/\d+/, ':id')} ${fmt(ts)}`);
    assert.ok(ts.reduce((a, b) => a + b, 0) / ts.length <= 1000, url);
  }
  const s = h.ok(await h.api('GET', `/api/exams/${id}/stats/summary`, { token: ctx.tk }));
  // 手算：50 人得分 k%6×2，k=0..49 → 0..10 循环；和 = 8 轮×30 + (0+2) = 242 → 平均 4.84
  assert.equal(s.actual_count, 50);
  assert.equal(s.average_score, 4.84);
});

test('NFR-PERF-03 100 次并发登录：全部成功，记录 P95', async (t) => {
  const t0 = performance.now();
  const rs = await Promise.all(ctx.concStudents.slice(0, 100).map((u) => timed(() => h.api('POST', '/api/auth/login', { body: { username: u, password: 'Abc12345' } }))));
  const wall = performance.now() - t0;
  assert.ok(rs.every(([, r]) => r.code === 0));
  const ts = rs.map(([ms]) => ms);
  t.diagnostic(`并发登录 ${fmt(ts)} 总耗时=${wall.toFixed(0)}ms`);
  ctx.tokens = rs.map(([, r]) => r.data.token);
  const rest = await Promise.all(ctx.concStudents.slice(100).map((u) => h.api('POST', '/api/auth/login', { body: { username: u, password: 'Abc12345' } })));
  ctx.tokens.push(...rest.map((r) => r.data.token));
  assert.equal(ctx.tokens.length, 200);
});

test('NFR-PERF-04 200 名学生并发开始作答 / 保存答案 / 交卷：成功率 100%，数据无丢失或互相覆盖，记录 P95', async (t) => {
  const starts = await Promise.all(ctx.tokens.map((tk) => timed(() => h.api('POST', `/api/student/exams/${ctx.liveExam}/start`, { token: tk }))));
  assert.ok(starts.every(([, r]) => r.code === 0));
  t.diagnostic(`并发 start(200) ${fmt(starts.map(([ms]) => ms))}`);
  const sids = starts.map(([, r]) => r.data.submission_id);
  assert.equal(new Set(sids).size, 200);
  const [pqS, pqM, pqJ, pqF] = [ctx.pqs.find((p) => p.type === 'single'), ctx.pqs.find((p) => p.type === 'multiple'), ctx.pqs.find((p) => p.type === 'judge'), ctx.pqs.find((p) => p.type === 'fill')];
  const answersFor = (i) => [
    { paper_question_id: pqS.id, response: i % 2 ? 'A' : 'B' },
    { paper_question_id: pqM.id, response: i % 3 ? ['A', 'B'] : ['C'] },
    { paper_question_id: pqJ.id, response: i % 4 === 0 },
    { paper_question_id: pqF.id, response: [`ans-${i}`] },
  ];
  // 第 1 轮：100 个并发保存（记录 P95）
  const save100 = await Promise.all(ctx.tokens.slice(0, 100).map((tk, i) => timed(() => h.api('PUT', `/api/submissions/${sids[i]}/answers`, { token: tk, body: { answers: answersFor(i) } }))));
  assert.ok(save100.every(([, r]) => r.code === 0));
  t.diagnostic(`100 并发保存答案 ${fmt(save100.map(([ms]) => ms))}`);
  // 第 2 轮：200 个并发保存
  const t0 = performance.now();
  const save200 = await Promise.all(ctx.tokens.map((tk, i) => timed(() => h.api('PUT', `/api/submissions/${sids[i]}/answers`, { token: tk, body: { answers: answersFor(i) } }))));
  assert.ok(save200.every(([, r]) => r.code === 0));
  t.diagnostic(`200 并发保存答案 ${fmt(save200.map(([ms]) => ms))} 总耗时=${(performance.now() - t0).toFixed(0)}ms`);
  // 集中交卷
  const subs = await Promise.all(ctx.tokens.map((tk, i) => timed(() => h.api('POST', `/api/submissions/${sids[i]}/submit`, { token: tk, body: {} }))));
  assert.ok(subs.every(([, r]) => r.code === 0 && r.data.submit_type === 'manual'));
  t.diagnostic(`200 并发交卷 ${fmt(subs.map(([ms]) => ms))}`);
  // 核对每份答卷内容
  const data = h.server.store.data;
  for (let i = 0; i < 200; i++) {
    const exp = answersFor(i);
    for (const a of exp) {
      const got = data.answers.find((x) => x.submission_id === sids[i] && x.paper_question_id === a.paper_question_id);
      assert.deepEqual(got.response, Array.isArray(a.response) ? [...a.response].sort() : a.response, `学生 ${i}`);
    }
    const sub = data.submissions.find((s) => s.id === sids[i]);
    // 手算客观分：单选 A 对（i 奇数）、多选 [A,B] 对（i%3≠0）、判断 true 对（i%4==0）、填空 x 永不对
    const exp2 = (i % 2 ? 2 : 0) + (i % 3 ? 2 : 0) + (i % 4 === 0 ? 2 : 0);
    assert.equal(sub.total_score, exp2, `学生 ${i} 得分`);
  }
});
