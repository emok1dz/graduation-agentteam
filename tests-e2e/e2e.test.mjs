// 端到端测试（Playwright + chromium）：浏览器走通完整业务闭环
//   教师登录建题 → 组卷 → 发布考试 → 学生登录作答 → 交卷 → 教师批改 → 发布成绩 → 学生查看成绩
// 另含：XSS（题干含 <script>/<img onerror> 时页面不执行）、CSP 违规监测、作答页不泄露答案。
// 运行：node tests-e2e/e2e.test.mjs   （后端在本进程内以临时 DATA_DIR、随机端口启动；用后端假时钟推进考试时间）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const { start } = await import(path.join(here, '../backend/server.mjs'));
const clock = await import(path.join(here, '../backend/src/core/clock.mjs'));

const XSS_STEM = 'E2E单选<script>window.__xss=1</script><img src=x onerror="window.__xss=2">1+1=?';
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), 'exam-e2e-shots');

let server, dataDir, base, browser;
const pages = [];
const consoleErrors = [];
const dialogs = [];
const ctx = {};

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  pages.push(page);
  return page;
}
async function login(page, username, password, homeHash) {
  await page.goto(base + '/#/login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('form button[type=submit]');
  await page.waitForFunction((hh) => location.hash.startsWith(hh), homeHash, { timeout: 10_000 });
}
const waitHash = (page, re) => page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source, { timeout: 10_000 });
const toast = (page, text) => page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 10_000 });
const db = () => server.store.data;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-e2e-'));
  await fs.mkdir(SHOT_DIR, { recursive: true });
  server = await start({ port: 0, host: '127.0.0.1', dataDir, scheduler: false });
  base = server.url;
  browser = await chromium.launch();
});

after(async () => {
  for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(SHOT_DIR, `final-${i}.png`), fullPage: true }).catch(() => {});
  await browser?.close();
  clock.reset();
  await server?.stop();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('E2E-01 教师登录并通过页面新建单选题（题干含 XSS 载荷）与简答题', async () => {
  const t = await newPage();
  ctx.teacher = t;
  await login(t, 'teacher1', 'teacher123', '#/teacher/questions');

  // 单选题
  await t.goto(base + '/#/teacher/questions/new');
  await t.locator('[data-field=stem] textarea').fill(XSS_STEM);
  const rows = t.locator('.option-editor-row');
  await rows.nth(0).locator('input[type=text]').fill('1');
  await rows.nth(1).locator('input[type=text]').fill('2');
  await rows.nth(2).locator('input[type=text]').fill('3');
  await rows.nth(3).locator('input[type=text]').fill('4');
  await rows.nth(1).locator('input[type=radio]').check();
  await t.locator('[data-field=score] input').fill('2');
  await t.locator('.sticky-actions button.btn-primary', { hasText: '保存' }).click();
  await toast(t, '题目已保存');
  await waitHash(t, /^#\/teacher\/questions$/);

  // 简答题
  await t.goto(base + '/#/teacher/questions/new');
  await t.locator('[data-field=type] select').selectOption('essay');
  await t.locator('[data-field=stem] textarea').fill('E2E简答：简述自动化测试的价值');
  await t.locator('[data-field=answer] textarea').fill('提高回归效率');
  await t.locator('[data-field=score] input').fill('10');
  await t.locator('.sticky-actions button.btn-primary', { hasText: '保存' }).click();
  await toast(t, '题目已保存');

  const qs = db().questions.filter((q) => q.stem.startsWith('E2E'));
  assert.equal(qs.length, 2);
  const single = qs.find((q) => q.type === 'single');
  assert.equal(single.stem, XSS_STEM, '题干原样存储');
  assert.equal(single.answer, 'B');
  // 题库列表页：XSS 题干以文本显示、未执行
  await t.goto(base + '/#/teacher/questions');
  await t.getByText('E2E单选<script>', { exact: false }).first().waitFor();
  assert.equal(await t.evaluate(() => window.__xss), undefined, 'XSS 不得执行');
});

test('E2E-02 教师手动组卷（筛选 E2E 题目 → 本页全部加入 → 保存），总分 12', async () => {
  const t = ctx.teacher;
  await t.goto(base + '/#/teacher/papers/new');
  await t.locator('.tabs button', { hasText: '手动选题' }).click();
  await t.locator('input[placeholder="题干关键字"]').fill('E2E');
  await t.locator('input[placeholder="题干关键字"]').press('Enter');
  await t.locator('table tbody tr').filter({ hasText: 'E2E简答' }).waitFor();
  await t.locator('button', { hasText: '本页全部加入' }).click();
  await t.locator('.pq-row').nth(1).waitFor();
  await t.locator('[data-field=title] input').fill('E2E试卷');
  await t.locator('button', { hasText: '保存试卷' }).click();
  await waitHash(t, /^#\/teacher\/papers\/\d+$/);
  const paper = db().papers.find((p) => p.title === 'E2E试卷');
  assert.ok(paper);
  assert.equal(paper.total_score, 12);
  assert.equal(paper.question_count, 2);
  ctx.paperId = paper.id;
  // 预览页同样不执行 XSS
  await t.getByText('E2E单选<script>', { exact: false }).first().waitFor();
  assert.equal(await t.evaluate(() => window.__xss), undefined);
});

test('E2E-03 教师发布考试（开始=当前+2 分钟，窗口 30 分钟，时长 20 分钟，班级 计科2101）', async () => {
  const t = ctx.teacher;
  await t.goto(base + '/#/teacher/exams/new');
  await t.locator('[data-field=paper_id] select').selectOption(String(ctx.paperId));
  await t.locator('[data-field=title] input').fill('E2E考试');
  const { s, e } = await t.evaluate(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const st = new Date(Date.now() + 2 * 60_000);
    st.setSeconds(0, 0);
    st.setMinutes(st.getMinutes() + 1);
    return { s: fmt(st), e: fmt(new Date(st.getTime() + 30 * 60_000)) };
  });
  await t.locator('[data-field=start_time] input').fill(s);
  await t.locator('[data-field=end_time] input').fill(e);
  await t.locator('[data-field=duration_minutes] input').fill('20');
  await t.locator('[data-field=class_ids] label', { hasText: '计科2101' }).locator('input').check();
  await t.locator('.sticky-actions button', { hasText: '发布考试' }).click();
  await toast(t, '考试发布成功');
  await waitHash(t, /^#\/teacher\/exams$/);
  const exam = db().exams.find((x) => x.title === 'E2E考试');
  assert.ok(exam);
  assert.equal(exam.duration_minutes, 20);
  assert.equal(exam.pass_score, 7.2);
  ctx.exam = exam;
});

test('E2E-04 学生登录 → 考试开始后进入作答 → 作答页不含答案 → 自动保存 → 交卷', async () => {
  // 服务端时钟推进到开考后 30 秒
  clock.setNow(Date.parse(ctx.exam.start_time) + 30_000);
  const s = await newPage();
  ctx.student = s;
  await login(s, 'student1', 'student123', '#/student/exams');
  const card = s.locator('.card, .exam-card').filter({ hasText: 'E2E考试' }).first();
  await card.waitFor();
  await card.locator('a', { hasText: '开始作答' }).click();
  await waitHash(s, new RegExp(`^#/student/exams/${ctx.exam.id}$`));
  await s.locator('label.check input[type=checkbox]').check();
  await s.locator('button', { hasText: '开始作答' }).click();
  await waitHash(s, /\/take$/);
  await s.locator('.question').nth(1).waitFor();
  // 倒计时以服务端时间为准：截止 = 开始 + 20 分钟 → 显示约 00:19:xx / 00:20:00（FR-ANS-02）
  await s.waitForFunction(() => /^00:(19|20):\d\d$/.test(document.querySelector('.countdown')?.textContent || ''), null, { timeout: 5000 });
  // 作答页：XSS 不执行；DOM 中无参考答案
  const text = await s.locator('body').innerText();
  assert.ok(text.includes('E2E单选<script>'), '题干以纯文本显示');
  assert.ok(!text.includes('提高回归效率'), '作答页不得出现参考答案');
  assert.equal(await s.evaluate(() => window.__xss), undefined);
  // 选择 B（选择题立即保存）
  await s.locator('.question').first().locator('label.option', { hasText: 'B.' }).click();
  await s.locator('.save-status.ok').waitFor({ timeout: 10_000 });
  // 简答（2s 防抖保存）
  await s.locator('.question textarea').fill('自动化测试能快速发现回归缺陷');
  await s.locator('.save-status.ok').waitFor({ timeout: 10_000 });
  await s.waitForFunction(() => /已保存/.test(document.querySelector('.save-status')?.textContent || ''), null, { timeout: 10_000 });
  const sub = db().submissions.find((x) => x.exam_id === ctx.exam.id);
  ctx.subId = sub.id;
  await s.waitForFunction(() => true);
  // 交卷：确认框
  await s.locator('.take-page button.btn-primary', { hasText: '交卷' }).first().click();
  await s.locator('.modal button', { hasText: '确认交卷' }).click();
  await s.getByText('已交卷，等待成绩发布').waitFor({ timeout: 10_000 });
  const done = db().submissions.find((x) => x.id === ctx.subId);
  assert.equal(done.status, 'pending_review');
  assert.equal(done.submit_type, 'manual');
  assert.equal(done.objective_score, 2);
  const ans = db().answers.filter((a) => a.submission_id === ctx.subId);
  assert.ok(ans.some((a) => a.response === 'B'));
  assert.ok(ans.some((a) => a.response === '自动化测试能快速发现回归缺陷'));
});

test('E2E-05 考试结束后教师批改简答题（8 分）并发布成绩', async () => {
  clock.setNow(Date.parse(ctx.exam.end_time) + 60_000);
  const t = ctx.teacher;
  await t.goto(base + `/#/teacher/exams/${ctx.exam.id}/grading`);
  const scoreIn = t.locator('input[type=number][placeholder="0 ~ 10"]').first();
  await scoreIn.waitFor();
  await scoreIn.fill('8');
  await t.locator('input[placeholder="评语（可选）"]').first().fill('要点清楚');
  await t.locator('button.btn-primary', { hasText: /^保存$/ }).first().click();
  await toast(t, '已完成批改，总分 10');
  await t.locator('button', { hasText: '发布成绩' }).click();
  await t.locator('.modal button', { hasText: '确认发布' }).click();
  await toast(t, '成绩已发布');
  const exam = db().exams.find((x) => x.id === ctx.exam.id);
  assert.equal(exam.results_published, true);
  const sub = db().submissions.find((x) => x.id === ctx.subId);
  assert.deepEqual([sub.status, sub.objective_score, sub.subjective_score, sub.total_score], ['graded', 2, 8, 10]);
});

test('E2E-06 学生查看成绩：总分 10、及格、答卷回顾含评语与正确答案', async () => {
  const s = ctx.student;
  await s.goto(base + '/#/student/results');
  await s.locator('a, button', { hasText: /查看|详情|E2E考试/ }).first().waitFor();
  await s.goto(base + `/#/student/results/${ctx.exam.id}`);
  const total = s.locator('.stat', { hasText: '总分' }).locator('.stat-value');
  await total.waitFor();
  assert.equal((await total.innerText()).trim(), '10');
  assert.equal((await s.locator('.stat', { hasText: '结果' }).locator('.stat-value').innerText()).trim(), '及格');
  const text = await s.locator('body').innerText();
  assert.ok(text.includes('要点清楚'), '显示评语');
  assert.ok(text.includes('提高回归效率'), '发布后可见参考答案');
  assert.ok(text.includes('E2E单选<script>'));
  assert.equal(await s.evaluate(() => window.__xss), undefined);
});

test('E2E-07 全程无 XSS 弹窗、无 CSP 违规、无页面脚本错误；响应头含 CSP', async () => {
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.deepEqual(dialogs, [], `意外弹窗：${dialogs.join(' | ')}`);
  const csp = consoleErrors.filter((m) => /Content Security Policy|Refused to/i.test(m));
  // 题干中的 <img src=x> 只作为文本渲染，不应产生任何资源请求或 CSP 违规
  assert.deepEqual(csp, [], csp.join('\n'));
  const pageErrors = consoleErrors.filter((m) => m.startsWith('pageerror'));
  assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
  if (consoleErrors.length) console.log('# console errors (非致命):', consoleErrors.join(' | '));
});

test('E2E-08 首屏静态资源总大小 ≤ 300KB、可交互时间 ≤ 2s（NFR-03，本机）', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let bytes = 0;
  const files = [];
  page.on('response', async (r) => {
    if (!r.url().startsWith(base) || r.url().includes('/api/')) return;
    try { const b = await r.body(); bytes += b.length; files.push(r.url().slice(base.length)); } catch { /* ignore */ }
  });
  const t0 = Date.now();
  await page.goto(base + '/#/login');
  await page.locator('#login-username').waitFor();
  const ready = Date.now() - t0;
  await page.waitForLoadState('networkidle');
  console.log(`# 首屏：${files.length} 个静态文件，共 ${(bytes / 1024).toFixed(1)} KB，可交互 ${ready} ms`);
  assert.ok(bytes <= 300 * 1024, `${bytes} bytes`);
  assert.ok(ready <= 2000, `${ready} ms`);
  await context.close();
});
