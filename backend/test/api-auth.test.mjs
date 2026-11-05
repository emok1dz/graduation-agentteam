// 接口集成测试：认证与会话（FR-AUTH-01~03、NFR-04/05）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, SEED } from './helpers/harness.mjs';

let h;
const T0 = Date.parse('2026-11-05T00:00:00.000Z');
before(async () => {
  clock.setNow(T0);
  h = await startHarness();
});
after(() => h.close());

test('IT-AUTH-01 正确账号密码登录：返回 64 位 token、过期时间、用户视图（无 hash/salt）', async () => {
  const d = h.ok(await h.api('POST', '/api/auth/login', { body: { username: 'teacher1', password: 'teacher123' } }));
  assert.match(d.token, /^[0-9a-f]{64}$/);
  assert.equal(Date.parse(d.expires_at) - T0, 2 * 3600_000);
  assert.equal(d.user.role, 'teacher');
  assert.equal(d.user.password_hash, undefined);
  assert.equal(d.user.password_salt, undefined);
});

test('IT-AUTH-02 错误密码 / 不存在账号：统一 401/40101 且提示相同', async () => {
  const a = h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student2', password: 'wrong999' } }), 401, 40101);
  const b = h.err(await h.api('POST', '/api/auth/login', { body: { username: 'nobody', password: 'wrong999' } }), 401, 40101);
  assert.equal(a.message, b.message);
});

test('IT-AUTH-03 登录参数校验：缺字段 40000（字段级 errors），非 JSON 40001', async () => {
  const r = h.err(await h.api('POST', '/api/auth/login', { body: { username: '' } }), 400, 40000);
  assert.deepEqual(r.data.errors.map((e) => e.field).sort(), ['password', 'username']);
  h.err(await h.api('POST', '/api/auth/login', { raw: '{bad json' }), 400, 40001);
});

test('IT-AUTH-04 连续 5 次错误锁定 10 分钟（42900），期间正确密码也被拒；到期后可登录', async () => {
  for (let i = 1; i <= 4; i++) h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student1', password: `bad${i}xx` } }), 401, 40101);
  const r5 = h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student1', password: 'bad5xx' } }), 429, 42900);
  assert.equal(Date.parse(r5.data.locked_until) - clock.nowMs(), 10 * 60_000);
  h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student1', password: 'student123' } }), 429, 42900);
  clock.advance(10 * 60_000 + 1000);
  await h.login(...SEED.student1);
  // 成功登录后计数清零：再错 1 次仍是 40101
  h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student1', password: 'bad' } }), 401, 40101);
});

test('IT-AUTH-05 无 token / 格式错误 / 伪造 token → 401/40100', async () => {
  h.err(await h.api('GET', '/api/auth/me'), 401, 40100);
  h.err(await h.api('GET', '/api/auth/me', { headers: { Authorization: 'Basic abc' } }), 401, 40100);
  h.err(await h.api('GET', '/api/auth/me', { token: 'not-a-token' }), 401, 40100);
  h.err(await h.api('GET', '/api/auth/me', { token: 'a'.repeat(64) }), 401, 40100);
});

test('IT-AUTH-06 会话空闲 2h 过期（401），活跃访问滑动续期', async () => {
  const tk = await h.login(...SEED.teacher1);
  clock.advance(90 * 60_000);
  const me = h.ok(await h.api('GET', '/api/auth/me', { token: tk })); // 续期
  assert.equal(me.username, 'teacher1');
  clock.advance(90 * 60_000); // 距上次活跃 1.5h < 2h
  h.ok(await h.api('GET', '/api/auth/me', { token: tk }));
  clock.advance(2 * 3600_000 + 1000); // 空闲超过 2h
  h.err(await h.api('GET', '/api/auth/me', { token: tk }), 401, 40100);
});

test('IT-AUTH-07 退出后 token 失效', async () => {
  const tk = await h.login(...SEED.student2);
  h.ok(await h.api('POST', '/api/auth/logout', { token: tk }));
  h.err(await h.api('GET', '/api/auth/me', { token: tk }), 401, 40100);
});

test('IT-AUTH-08 修改密码：原密码错 40003、策略不符 40000、成功后其他会话失效、新密码可登录', async () => {
  const a = await h.login(...SEED.student2);
  const b = await h.login(...SEED.student2);
  h.err(await h.api('PUT', '/api/auth/password', { token: a, body: { old_password: 'xxx111', new_password: 'Newpass1', confirm_password: 'Newpass1' } }), 400, 40003);
  const v = h.err(await h.api('PUT', '/api/auth/password', { token: a, body: { old_password: 'student123', new_password: 'short', confirm_password: 'diff' } }), 400, 40000);
  assert.deepEqual(v.data.errors.map((e) => e.field).sort(), ['confirm_password', 'new_password']);
  h.ok(await h.api('PUT', '/api/auth/password', { token: a, body: { old_password: 'student123', new_password: 'Newpass1', confirm_password: 'Newpass1' } }));
  h.ok(await h.api('GET', '/api/auth/me', { token: a }), 200);
  h.err(await h.api('GET', '/api/auth/me', { token: b }), 401, 40100);
  h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student2', password: 'student123' } }), 401, 40101);
  await h.login('student2', 'Newpass1');
});

test('IT-AUTH-09 管理员禁用账号：会话立即失效，登录 403/40302；重置密码后旧会话失效', async () => {
  const admin = await h.login(...SEED.admin);
  const users = h.ok(await h.api('GET', '/api/users?role=student', { token: admin }));
  const s1 = users.items.find((u) => u.username === 'student1');
  const stk = await h.login(...SEED.student1);
  h.ok(await h.api('PUT', `/api/users/${s1.id}`, { token: admin, body: { status: 'disabled' } }));
  h.err(await h.api('GET', '/api/auth/me', { token: stk }), 401, 40100);
  h.err(await h.api('POST', '/api/auth/login', { body: { username: 'student1', password: 'student123' } }), 403, 40302);
  h.ok(await h.api('PUT', `/api/users/${s1.id}`, { token: admin, body: { status: 'active' } }));
  const stk2 = await h.login(...SEED.student1);
  h.ok(await h.api('POST', `/api/users/${s1.id}/reset-password`, { token: admin, body: {} }));
  h.err(await h.api('GET', '/api/auth/me', { token: stk2 }), 401, 40100);
  await h.login('student1', 'Pass1234');
  // 管理员不能禁用自己
  const me = h.ok(await h.api('GET', '/api/auth/me', { token: admin }));
  h.err(await h.api('PUT', `/api/users/${me.id}`, { token: admin, body: { status: 'disabled' } }), 403, 40303);
});
