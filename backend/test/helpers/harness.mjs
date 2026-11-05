// 测试工具：临时 DATA_DIR 启动后端实例 + fetch 封装 + 通用数据构造
// 每个测试文件（node --test 默认每文件独立进程）各自 startHarness()，互不影响。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { start } from '../../server.mjs';
import * as clock from '../../src/core/clock.mjs';

export { clock };

export const SEED = {
  admin: ['admin', 'admin123'],
  teacher1: ['teacher1', 'teacher123'],
  student1: ['student1', 'student123'],
  student2: ['student2', 'student123'],
};

export async function startHarness({ seed = true, config, prefix = 'exam-test-' } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const server = await start({ port: 0, host: '127.0.0.1', dataDir, scheduler: false, seed, config });
  const base = server.url;

  async function api(method, url, { token, body, raw, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') || '';
    const json = ct.includes('application/json') ? await res.json() : { text: await res.text() };
    return { status: res.status, headers: res.headers, ...json };
  }
  const ok = (r, status = 200) => {
    assert.equal(r.status, status, JSON.stringify({ status: r.status, code: r.code, message: r.message, data: r.data }));
    assert.equal(r.code, 0, JSON.stringify(r));
    return r.data;
  };
  const err = (r, status, code) => {
    assert.equal(r.status, status, `HTTP ${r.status} code=${r.code} msg=${r.message}`);
    assert.equal(r.code, code, `code=${r.code} msg=${r.message}`);
    return r;
  };
  const login = async (username, password) => ok(await api('POST', '/api/auth/login', { body: { username, password } })).token;

  async function close() {
    clock.reset();
    await server.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  return { server, base, dataDir, api, ok, err, login, close };
}

/** 题目模板（teacher 用） */
export const Q = {
  single: (extra = {}) => ({ type: 'single', stem: '单选：1+1=?', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }], answer: 'B', difficulty: 'easy', score: 2, ...extra }),
  multiple: (extra = {}) => ({ type: 'multiple', stem: '多选：偶数有？', options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }, { key: 'C', text: '4' }, { key: 'D', text: '5' }], answer: ['A', 'C'], difficulty: 'medium', score: 4, ...extra }),
  judge: (extra = {}) => ({ type: 'judge', stem: '判断：地球是圆的', answer: true, difficulty: 'easy', score: 2, ...extra }),
  fill: (extra = {}) => ({ type: 'fill', stem: '首都是 ___，建国于 ___ 年', answer: [['北京', 'Beijing'], ['1949']], difficulty: 'easy', score: 4, ...extra }),
  essay: (extra = {}) => ({ type: 'essay', stem: '简答：谈谈测试', answer: '参考答案', difficulty: 'hard', score: 10, ...extra }),
};

/**
 * 通用场景：
 *  - admin 建班 classX（teacher1 任课），学生 sx1..sxN（密码 Abc12345）
 *  - admin 建 teacher2（不任课 classX）
 *  - teacher1 建五种题型各 1 道，组卷（分值 = 题目分值），发布考试（start=now+60s，end=now+30min，时长 10 分钟）
 * 调用前应已 clock.setNow(T0)。
 */
export async function buildScenario(h, { students = 2, withEssay = true, durationMinutes = 10, startOffsetMs = 60_000, windowMs = 30 * 60_000, className } = {}) {
  const { api, ok, login } = h;
  const now = clock.nowMs();
  const admin = await login(...SEED.admin);
  const cls = ok(await api('POST', '/api/classes', { token: admin, body: { name: className || `测试班${now}${Math.random().toString(36).slice(2, 6)}`, grade: '2022', major: '软件工程' } }), 201);
  const stuNames = [];
  for (let i = 1; i <= students; i++) {
    const username = `s${cls.id}_${i}`;
    ok(await api('POST', '/api/users', { token: admin, body: { username, name: `学生${i}`, role: 'student', class_id: cls.id, password: 'Abc12345' } }), 201);
    stuNames.push(username);
  }
  const teachers = ok(await api('GET', '/api/users?role=teacher', { token: admin }));
  const t1 = teachers.items.find((u) => u.username === 'teacher1');
  ok(await api('PUT', `/api/classes/${cls.id}/teachers`, { token: admin, body: { teacher_ids: [t1.id] } }));
  let t2 = teachers.items.find((u) => u.username === 'teacher2');
  if (!t2) t2 = ok(await api('POST', '/api/users', { token: admin, body: { username: 'teacher2', name: '赵老师', role: 'teacher', password: 'Teach2pass' } }), 201);

  const tk = await login(...SEED.teacher1);
  const types = withEssay ? ['single', 'multiple', 'judge', 'fill', 'essay'] : ['single', 'multiple', 'judge', 'fill'];
  const qs = {};
  for (const t of types) qs[t] = ok(await api('POST', '/api/questions', { token: tk, body: Q[t]() }), 201);
  const paper = ok(await api('POST', '/api/papers', { token: tk, body: { title: `场景试卷${cls.id}`, items: types.map((t) => ({ question_id: qs[t].id, score: qs[t].score })) } }), 201);
  const exam = ok(await api('POST', '/api/exams', {
    token: tk,
    body: {
      title: `场景考试${cls.id}`, paper_id: paper.id, class_ids: [cls.id], duration_minutes: durationMinutes,
      start_time: new Date(now + startOffsetMs).toISOString(), end_time: new Date(now + startOffsetMs + windowMs).toISOString(),
    },
  }), 201);
  const pq = Object.fromEntries(paper.questions.map((q) => [q.type, q.id]));
  return { admin, tk, cls, stuNames, t1, t2, qs, paper, exam, pq, startMs: now + startOffsetMs, endMs: now + startOffsetMs + windowMs };
}
