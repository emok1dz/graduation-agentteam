// 非功能测试：安全（NFR-04 密码存储、NFR-08 答案保密、NFR-09 输入校验/XSS/路径穿越、安全响应头）、可靠性（NFR-10）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { startHarness, clock, SEED, buildScenario, Q } from './helpers/harness.mjs';

let h, sc;
before(async () => {
  clock.setNow(Date.parse('2026-11-05T08:00:00.000Z'));
  h = await startHarness();
  sc = await buildScenario(h, { students: 1 });
});
after(() => h.close());

test('NFR-SEC-01 db.json 中密码不以明文存储（无 password 字段、hash≠明文、每用户独立盐）', async () => {
  await h.server.store.flush();
  const text = await fs.readFile(path.join(h.dataDir, 'db.json'), 'utf8');
  for (const p of ['admin123', 'teacher123', 'student123', 'Abc12345', 'Teach2pass']) assert.ok(!text.includes(p), `明文 ${p} 出现在 db.json`);
  const db = JSON.parse(text);
  assert.ok(db.users.every((u) => !('password' in u) && /^[0-9a-f]{128}$/.test(u.password_hash) && /^[0-9a-f]{32}$/.test(u.password_salt)));
  assert.equal(new Set(db.users.map((u) => u.password_salt)).size, db.users.length);
  // 会话只存 SHA-256(token)
  const tk = await h.login(...SEED.admin);
  await h.server.store.flush();
  const text2 = await fs.readFile(path.join(h.dataDir, 'db.json'), 'utf8');
  assert.ok(!text2.includes(tk), '令牌原文不得落盘');
});

test('NFR-SEC-02 安全响应头：API 与静态页面均带 CSP / nosniff / X-Frame-Options / Referrer-Policy；API no-store', async () => {
  for (const url of ['/', '/index.html', '/js/main.js', '/api/auth/me']) {
    const r = await fetch(h.base + url);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'self'; img-src 'self' data:; style-src 'self'", url);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
  const api = await fetch(h.base + '/api/auth/me');
  assert.match(api.headers.get('cache-control') || '', /no-store/);
});

test('NFR-SEC-03 答题接口不泄露答案：start/save 响应与学生考试列表均不含 answer/analysis/参考答案', async () => {
  clock.setNow(sc.startMs + 1000);
  const s = await h.login(sc.stuNames[0], 'Abc12345');
  const sheet = await h.api('POST', `/api/student/exams/${sc.exam.id}/start`, { token: s });
  const list = await h.api('GET', '/api/student/exams', { token: s });
  const one = await h.api('GET', `/api/student/exams/${sc.exam.id}`, { token: s });
  for (const r of [sheet, list, one]) {
    const raw = JSON.stringify(r.data);
    assert.ok(!/"answer"|"analysis"|"correct_answer"|参考答案|"is_correct"/.test(raw), raw.slice(0, 200));
  }
  // 填空题可接受答案 “Beijing” 也不应出现
  assert.ok(!JSON.stringify(sheet.data).includes('Beijing'));
  // 交卷后、成绩未发布前，结果接口也不泄露答案与分数
  h.ok(await h.api('POST', `/api/submissions/${sheet.data.submission_id}/submit`, { token: s, body: {} }));
  const res = h.ok(await h.api('GET', `/api/student/results/${sc.exam.id}`, { token: s }));
  assert.ok(!/参考答案|Beijing/.test(JSON.stringify(res)));
  assert.equal(res.submission.objective_score, null);
});

test('NFR-SEC-04 XSS：题干含 <script> 原样存储与返回（不转义也不执行，由前端 textContent 渲染）', async () => {
  const stem = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">题干';
  const q = h.ok(await h.api('POST', '/api/questions', { token: sc.tk, body: Q.essay({ stem }) }), 201);
  assert.equal(q.stem, stem);
  // 前端源码不使用 innerHTML / insertAdjacentHTML / document.write / eval
  const root = path.resolve(import.meta.dirname, '../../frontend/js');
  const files = [];
  const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); };
  await walk(root);
  for (const f of files) {
    const src = await fs.readFile(f, 'utf8');
    assert.ok(!/\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src), `危险 API: ${f}`);
  }
});

test('NFR-SEC-05 请求体 > 1MB → 413/41300；非 JSON → 40001', async () => {
  const big = JSON.stringify({ username: 'x'.repeat(1024 * 1024 + 10), password: 'a' });
  const r = await h.api('POST', '/api/auth/login', { raw: big });
  assert.equal(r.status, 413);
  assert.equal(r.code, 41300);
  h.err(await h.api('POST', '/api/questions', { token: sc.tk, raw: 'not json' }), 400, 40001);
});

test('NFR-SEC-06 静态资源路径穿越被拒（../、编码 %2e%2e、空字节）', async () => {
  const raw = (p) => new Promise((resolve, reject) => {
    const u = new URL(h.base);
    const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  for (const p of ['/../backend/server.mjs', '/..%2f..%2fbackend%2fserver.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/js/%00main.js', '/../../etc/passwd']) {
    const r = await raw(p);
    assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
    assert.ok(!r.body.includes('export async function start') && !r.body.includes('root:'), p);
  }
});

test('NFR-REL-01 重启后数据不丢失（stop 落盘 → 同一 DATA_DIR 重新 start）', async () => {
  const { start } = await import('../server.mjs');
  const qCount = h.server.store.data.questions.length;
  await h.server.stop();
  const s2 = await start({ port: 0, host: '127.0.0.1', dataDir: h.dataDir, scheduler: false });
  try {
    assert.equal(s2.store.data.questions.length, qCount);
    const r = await fetch(s2.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    assert.equal(r.status, 200);
  } finally {
    await s2.stop();
  }
});

test('NFR-SEC-07 CSV 导出应防公式注入（以 = + - @ 开头的单元格需前置 \' 或转义）', { todo: '缺陷 BUG-02：姓名 "=1+2" 原样写入 CSV' }, async () => {
  const h2 = await startHarness();
  try {
    clock.setNow(Date.parse('2026-11-05T08:00:00.000Z'));
    const sc2 = await buildScenario(h2, { students: 0 });
    h2.ok(await h2.api('POST', '/api/users', { token: sc2.admin, body: { username: 'csvinj', name: '=1+2', role: 'student', class_id: sc2.cls.id } }), 201);
    const res = await fetch(`${h2.base}/api/exams/${sc2.exam.id}/scores/export`, { headers: { Authorization: `Bearer ${sc2.tk}` } });
    const line = (await res.text()).split('\r\n').find((l) => l.includes('csvinj'));
    assert.ok(!/(^|,)=1\+2(,|$)/.test(line), line);
  } finally {
    await h2.close();
  }
});
