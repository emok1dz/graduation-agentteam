// 密码：scrypt + 16 字节随机盐；常量时间比较
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

function scryptAsync(pwd, salt) {
  return new Promise((resolve, reject) => {
    scrypt(pwd, salt, KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(pwd) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(String(pwd), Buffer.from(salt, 'hex'));
  return { hash: key.toString('hex'), salt };
}

export async function verifyPassword(pwd, hash, salt) {
  const key = await scryptAsync(String(pwd), Buffer.from(salt, 'hex'));
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

// 账号不存在时用于消耗等长时间，防止时序枚举
const DUMMY_SALT = randomBytes(16).toString('hex');
export async function dummyVerify(pwd) {
  await scryptAsync(String(pwd), Buffer.from(DUMMY_SALT, 'hex'));
  return false;
}

/** 6~32 位，同时包含字母与数字；返回错误信息或 null */
export function checkPasswordPolicy(pwd) {
  if (typeof pwd !== 'string') return '密码必须为字符串';
  if (pwd.length < 6 || pwd.length > 32) return '密码长度须为 6~32 位';
  if (!/[A-Za-z]/.test(pwd) || !/\d/.test(pwd)) return '密码须同时包含字母和数字';
  return null;
}
