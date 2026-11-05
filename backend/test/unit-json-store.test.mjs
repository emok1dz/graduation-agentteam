// 单元测试：repositories/json-store（原子写 tmp→fsync→rename、回滚、合并写、损坏文件拒绝启动）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, emptyDb, COLLECTIONS } from '../src/repositories/json-store.mjs';

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-store-'));
  return { dir, file: path.join(dir, 'sub', 'db.json') };
}
async function write(store, coll, doc) {
  return store.transaction(async () => {
    store.touch(coll);
    store.data[coll] = [...store.data[coll], { id: store.nextId(coll), ...doc }];
  });
}

test('UT-STORE-01 空文件启动得到空库，含全部集合', async () => {
  const { dir, file } = await tmpFile();
  const s = await JsonStore.open(file);
  assert.ok(s.isEmpty());
  for (const c of COLLECTIONS) assert.deepEqual(s.data[c], []);
  assert.deepEqual(Object.keys(emptyDb().meta.seq).length > 0, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-02 事务提交后落盘，完成后不残留 .tmp，重新打开数据一致', async () => {
  const { dir, file } = await tmpFile();
  const s = await JsonStore.open(file);
  await write(s, 'users', { username: 'u1' });
  const disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(disk.users[0].username, 'u1');
  assert.equal(disk.meta.seq.users, 1);
  await assert.rejects(fs.access(file + '.tmp'));
  const s2 = await JsonStore.open(file);
  assert.equal(s2.data.users[0].username, 'u1');
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-03 事务抛错回滚：数据与序号恢复，磁盘不变', async () => {
  const { dir, file } = await tmpFile();
  const s = await JsonStore.open(file);
  await write(s, 'users', { username: 'u1' });
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(s.transaction(async () => {
    s.touch('users');
    s.data.users = [...s.data.users, { id: s.nextId('users'), username: 'u2' }];
    throw new Error('boom');
  }), /boom/);
  assert.equal(s.data.users.length, 1);
  assert.equal(s.data.meta.seq.users, 1);
  await s.flush();
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-04 并发 50 个事务串行执行、id 连续、写入合并（写次数 < 事务数）', async () => {
  const { dir, file } = await tmpFile();
  const s = await JsonStore.open(file);
  await Promise.all(Array.from({ length: 50 }, (_, i) => write(s, 'tags', { name: `t${i}` })));
  await s.flush();
  assert.deepEqual(s.data.tags.map((t) => t.id), Array.from({ length: 50 }, (_, i) => i + 1));
  const disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(disk.tags.length, 50);
  assert.ok(s.writeCount < 50, `writeCount=${s.writeCount}`);
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-05 原子写：落盘过程中任意时刻 db.json 都是完整合法 JSON', async () => {
  const { dir, file } = await tmpFile();
  const s = await JsonStore.open(file);
  await write(s, 'questions', { stem: 'x'.repeat(200_000) });
  let reads = 0;
  let stop = false;
  const reader = (async () => {
    while (!stop) {
      const txt = await fs.readFile(file, 'utf8');
      JSON.parse(txt); // 非原子写会读到半截文件而抛错
      reads++;
    }
  })();
  for (let i = 0; i < 30; i++) await write(s, 'questions', { stem: 'y'.repeat(200_000) });
  stop = true;
  await reader;
  assert.ok(reads > 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-06 启动时残留 .tmp 被清理；损坏的 db.json 拒绝启动且原文件不被修改', async () => {
  const { dir, file } = await tmpFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', '{half');
  await fs.writeFile(file, '{"users": [ broken');
  await assert.rejects(JsonStore.open(file), /解析失败/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"users": [ broken');
  await assert.rejects(fs.access(file + '.tmp'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('UT-STORE-07 旧文件缺少集合/seq 时补齐', async () => {
  const { dir, file } = await tmpFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ users: [{ id: 3 }], meta: { seq: { users: 3 } } }));
  const s = await JsonStore.open(file);
  assert.deepEqual(s.data.exams, []);
  assert.equal(s.data.meta.seq.users, 3);
  assert.equal(s.data.meta.seq.exams, 0);
  assert.equal(s.nextId('users'), 4);
  await fs.rm(dir, { recursive: true, force: true });
});
