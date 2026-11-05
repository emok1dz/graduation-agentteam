// 接口集成测试：用户管理（FR-USER-01~03）、班级管理（FR-CLASS-01~02）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, clock, SEED } from './helpers/harness.mjs';

let h, admin;
before(async () => {
  clock.setNow(Date.parse('2026-11-05T07:00:00.000Z'));
  h = await startHarness();
  admin = await h.login(...SEED.admin);
});
after(() => h.close());

test('IT-USER-01 用户列表：角色/状态/关键字筛选与分页；不返回 hash', async () => {
  const all = h.ok(await h.api('GET', '/api/users', { token: admin }));
  assert.equal(all.total, 4);
  assert.ok(all.items.every((u) => u.password_hash === undefined && u.password_salt === undefined));
  const st = h.ok(await h.api('GET', '/api/users?role=student', { token: admin }));
  assert.equal(st.total, 2);
  const kw = h.ok(await h.api('GET', `/api/users?keyword=${encodeURIComponent('王')}`, { token: admin }));
  assert.equal(kw.items[0].username, 'teacher1');
  const pg = h.ok(await h.api('GET', '/api/users?page=2&page_size=3', { token: admin }));
  assert.equal(pg.items.length, 1);
  h.err(await h.api('GET', '/api/users?role=boss', { token: admin }), 400, 40000);
});

test('IT-USER-02 新增用户：默认密码、账号重复 40900、学生必须有班级、密码策略', async () => {
  const u = h.ok(await h.api('POST', '/api/users', { token: admin, body: { username: 'newt', name: '新教师', role: 'teacher' } }), 201);
  assert.equal(u.status, 'active');
  await h.login('newt', 'Pass1234');
  h.err(await h.api('POST', '/api/users', { token: admin, body: { username: 'newt', name: 'x', role: 'teacher' } }), 409, 40900);
  const r = h.err(await h.api('POST', '/api/users', { token: admin, body: { username: 'news', name: 'x', role: 'student' } }), 400, 40000);
  assert.equal(r.data.errors[0].field, 'class_id');
  h.err(await h.api('POST', '/api/users', { token: admin, body: { username: 'news', name: 'x', role: 'teacher', password: 'abc' } }), 400, 40000);
  h.err(await h.api('POST', '/api/users', { token: admin, body: { username: 'news', name: 'x', role: 'student', class_id: 9999 } }), 404, 40400);
});

test('IT-USER-03 编辑/删除用户：改名；有题目的教师删除 40901；删除自己 40303；可删除无数据用户', async () => {
  const list = h.ok(await h.api('GET', '/api/users?page_size=100', { token: admin }));
  const newt = list.items.find((u) => u.username === 'newt');
  const t1 = list.items.find((u) => u.username === 'teacher1');
  const me = list.items.find((u) => u.username === 'admin');
  const u = h.ok(await h.api('PUT', `/api/users/${newt.id}`, { token: admin, body: { name: '改名教师' } }));
  assert.equal(u.name, '改名教师');
  h.err(await h.api('DELETE', `/api/users/${t1.id}`, { token: admin }), 409, 40901);
  h.err(await h.api('DELETE', `/api/users/${me.id}`, { token: admin }), 403, 40303);
  h.ok(await h.api('DELETE', `/api/users/${newt.id}`, { token: admin }));
  h.err(await h.api('GET', `/api/users/${newt.id}`, { token: admin }), 404, 40400);
});

test('IT-CLASS-01 班级 CRUD：重名 40900；有学生时删除 40901；空班级可删除', async () => {
  const c = h.ok(await h.api('POST', '/api/classes', { token: admin, body: { name: '网工2301', grade: '2023', major: '网络工程' } }), 201);
  h.err(await h.api('POST', '/api/classes', { token: admin, body: { name: '网工2301' } }), 409, 40900);
  h.err(await h.api('POST', '/api/classes', { token: admin, body: { name: '' } }), 400, 40000);
  const u = h.ok(await h.api('PUT', `/api/classes/${c.id}`, { token: admin, body: { name: '网工2302' } }));
  assert.equal(u.name, '网工2302');
  const list = h.ok(await h.api('GET', '/api/classes', { token: admin }));
  const seedCls = list.items.find((x) => x.name === '计科2101');
  assert.equal(seedCls.student_count, 2);
  h.err(await h.api('DELETE', `/api/classes/${seedCls.id}`, { token: admin }), 409, 40901);
  h.ok(await h.api('DELETE', `/api/classes/${c.id}`, { token: admin }));
});

test('IT-CLASS-02 成员管理：加入学生（已属他班 40909，force_move 转班）、移出、设置任课教师', async () => {
  const c = h.ok(await h.api('POST', '/api/classes', { token: admin, body: { name: '转班测试班' } }), 201);
  const s1 = h.ok(await h.api('GET', '/api/users?role=student', { token: admin })).items.find((u) => u.username === 'student1');
  const conflict = h.err(await h.api('POST', `/api/classes/${c.id}/students`, { token: admin, body: { student_ids: [s1.id] } }), 409, 40909);
  assert.equal(conflict.data.conflicts.length, 1);
  const m = h.ok(await h.api('POST', `/api/classes/${c.id}/students`, { token: admin, body: { student_ids: [s1.id], force_move: true } }));
  assert.deepEqual(m.students.map((s) => s.id), [s1.id]);
  const t1 = h.ok(await h.api('GET', '/api/users?role=teacher', { token: admin })).items.find((u) => u.username === 'teacher1');
  const m2 = h.ok(await h.api('PUT', `/api/classes/${c.id}/teachers`, { token: admin, body: { teacher_ids: [t1.id] } }));
  assert.deepEqual(m2.teachers.map((t) => t.id), [t1.id]);
  const tk = await h.login(...SEED.teacher1);
  const mem = h.ok(await h.api('GET', `/api/classes/${c.id}/members`, { token: tk }));
  assert.equal(mem.students.length, 1);
  const m3 = h.ok(await h.api('POST', `/api/classes/${c.id}/students/remove`, { token: admin, body: { student_ids: [s1.id] } }));
  assert.equal(m3.students.length, 0);
  // 学生只能查看本班
  const stk = await h.login(...SEED.student2);
  const own = h.ok(await h.api('GET', '/api/classes', { token: stk }));
  assert.ok(own.items.every((x) => x.name === '计科2101'));
});
