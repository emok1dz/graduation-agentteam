// 单元测试：domain/password（scrypt+盐、策略）与 domain/token
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, dummyVerify, checkPasswordPolicy } from '../src/domain/password.mjs';
import { generateToken, hashToken } from '../src/domain/token.mjs';
import { createHash } from 'node:crypto';

test('UT-PWD-01 hashPassword 生成 64B hash + 16B 盐，且不含明文', async () => {
  const { hash, salt } = await hashPassword('Abc12345');
  assert.match(hash, /^[0-9a-f]{128}$/);
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.ok(!hash.includes('Abc12345'));
});

test('UT-PWD-02 相同密码两次哈希盐与结果均不同', async () => {
  const a = await hashPassword('Abc12345');
  const b = await hashPassword('Abc12345');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('UT-PWD-03 verifyPassword：正确密码 true，错误密码 false，长度不符 false', async () => {
  const { hash, salt } = await hashPassword('Abc12345');
  assert.equal(await verifyPassword('Abc12345', hash, salt), true);
  assert.equal(await verifyPassword('abc12345', hash, salt), false);
  assert.equal(await verifyPassword('', hash, salt), false);
  assert.equal(await verifyPassword('Abc12345', hash.slice(0, 64), salt), false);
});

test('UT-PWD-04 单次 scrypt 耗时 ≥ 10ms（NFR-04 慢哈希）', async () => {
  const t = performance.now();
  await hashPassword('Abc12345');
  const ms = performance.now() - t;
  assert.ok(ms >= 10, `scrypt 仅 ${ms.toFixed(1)}ms`);
});

test('UT-PWD-05 dummyVerify 恒为 false（防时序枚举）', async () => {
  assert.equal(await dummyVerify('anything1'), false);
});

test('UT-PWD-06 checkPasswordPolicy：6~32 位且含字母与数字', () => {
  assert.equal(checkPasswordPolicy('Abc123'), null);
  assert.equal(checkPasswordPolicy('a1'.repeat(16)), null); // 32 位
  assert.match(checkPasswordPolicy('Ab1'), /6~32/);
  assert.match(checkPasswordPolicy('a1'.repeat(16) + 'x'), /6~32/);
  assert.match(checkPasswordPolicy('abcdefg'), /字母和数字/);
  assert.match(checkPasswordPolicy('1234567'), /字母和数字/);
  assert.match(checkPasswordPolicy(123456), /字符串/);
  assert.match(checkPasswordPolicy(undefined), /字符串/);
});

test('UT-TOK-01 generateToken 为 64 位 hex 且不重复', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) {
    const t = generateToken();
    assert.match(t, /^[0-9a-f]{64}$/);
    set.add(t);
  }
  assert.equal(set.size, 1000);
});

test('UT-TOK-02 hashToken = SHA-256(token)，确定性且不等于原文', () => {
  const t = generateToken();
  assert.equal(hashToken(t), createHash('sha256').update(t).digest('hex'));
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), t);
});
