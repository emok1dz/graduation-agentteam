// 集中配置（系统设计文档 §3.3），支持环境变量覆盖
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(BACKEND_DIR, '..');

function int(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    PORT: int(env.PORT, 3000),
    HOST: env.HOST || '0.0.0.0',
    DATA_DIR: path.resolve(env.DATA_DIR || path.join(BACKEND_DIR, 'data')),
    FRONTEND_DIR: path.resolve(env.FRONTEND_DIR || path.join(REPO_DIR, 'frontend')),
    STORAGE: env.STORAGE || 'json',
    SESSION_IDLE_MS: int(env.SESSION_IDLE_MS, 2 * 60 * 60 * 1000),
    SESSION_TOUCH_MS: 60 * 1000,
    LOGIN_MAX_FAILS: 5,
    LOGIN_LOCK_MS: 10 * 60 * 1000,
    BODY_LIMIT: 1024 * 1024,
    SUBMIT_GRACE_MS: 10 * 1000,
    SWEEP_INTERVAL_MS: 30 * 1000,
    SESSION_CLEAN_MS: 10 * 60 * 1000,
    DEFAULT_PASSWORD: env.DEFAULT_PASSWORD || 'Pass1234',
    SCRYPT: { N: 16384, r: 8, p: 1, keylen: 64 },
    SEED: env.SEED !== '0',
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cfg[k] = v;
  }
  if (overrides.DATA_DIR) cfg.DATA_DIR = path.resolve(overrides.DATA_DIR);
  if (overrides.FRONTEND_DIR) cfg.FRONTEND_DIR = path.resolve(overrides.FRONTEND_DIR);
  return cfg;
}
