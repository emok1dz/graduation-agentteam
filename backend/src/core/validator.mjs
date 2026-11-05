// 轻量校验器：逐字段校验并收集 errors[{field,message}]，最后统一抛 40000
import { validationError } from './errors.mjs';

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isScore1 = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x * 10 - Math.round(x * 10)) < 1e-6;
export const isIso = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s));

export class Validator {
  /**
   * @param {object} src 待校验对象（body 或 query）
   * @param {{query?: boolean, prefix?: string}} opts query=true 时把字符串转换为数字/布尔
   */
  constructor(src, { query = false, prefix = '' } = {}) {
    this.src = isPlainObject(src) ? src : {};
    this.query = query;
    this.prefix = prefix;
    this.errors = [];
  }
  f(field) {
    return this.prefix ? `${this.prefix}.${field}` : field;
  }
  err(field, message) {
    this.errors.push({ field: this.f(field), message });
    return undefined;
  }
  has(field) {
    const v = this.src[field];
    return v !== undefined && !(this.query && v === '');
  }
  raw(field) {
    return this.src[field];
  }
  str(field, { required = false, min = 0, max = Infinity, def, nullable = false, trim = true, pattern, label = field, patternMsg } = {}) {
    let v = this.src[field];
    if (v === undefined || (this.query && v === '')) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (v === null) {
      if (nullable) return null;
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (typeof v !== 'string') return this.err(field, `${label}必须为字符串`);
    if (trim) v = v.trim();
    if (required && v.length === 0) return this.err(field, `${label}不能为空`);
    if ([...v].length < min) return this.err(field, `${label}长度不能少于 ${min}`);
    if ([...v].length > max) return this.err(field, `${label}长度不能超过 ${max}`);
    if (pattern && !pattern.test(v)) return this.err(field, patternMsg || `${label}格式不正确`);
    return v;
  }
  int(field, { required = false, min = -Infinity, max = Infinity, def, nullable = false, label = field } = {}) {
    let v = this.src[field];
    if (v === undefined || (this.query && v === '')) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (v === null) {
      if (nullable) return null;
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (this.query && typeof v === 'string' && /^-?\d+$/.test(v)) v = Number(v);
    if (typeof v !== 'number' || !Number.isInteger(v)) return this.err(field, `${label}必须为整数`);
    if (v < min || v > max) {
      return this.err(field, max === Infinity ? `${label}必须 ≥ ${min}` : `${label}必须在 ${min}~${max} 之间`);
    }
    return v;
  }
  /** 分数：number，最多 1 位小数 */
  score(field, { required = false, min = 0, max = 100, gt = false, def, nullable = false, label = field } = {}) {
    const v = this.src[field];
    if (v === undefined) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (v === null) {
      if (nullable) return null;
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.err(field, `${label}必须为数字`);
    if (!isScore1(v)) return this.err(field, `${label}最多 1 位小数`);
    if (gt ? v <= min : v < min) return this.err(field, gt ? `${label}必须为正数` : `${label}不能小于 ${min}`);
    if (v > max) return this.err(field, `${label}不能大于 ${max}`);
    return Math.round(v * 10) / 10;
  }
  bool(field, { def, required = false, label = field } = {}) {
    let v = this.src[field];
    if (v === undefined || v === null || (this.query && v === '')) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (this.query && (v === 'true' || v === 'false')) v = v === 'true';
    if (typeof v !== 'boolean') return this.err(field, `${label}必须为布尔值`);
    return v;
  }
  enum(field, values, { required = false, def, nullable = false, label = field } = {}) {
    const v = this.src[field];
    if (v === undefined || (this.query && v === '')) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (v === null) {
      if (nullable) return null;
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (!values.includes(v)) return this.err(field, `${label}取值必须为 ${values.join('/')} 之一`);
    return v;
  }
  iso(field, { required = false, label = field } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null || v === '') {
      if (required) return this.err(field, `${label}不能为空`);
      return undefined;
    }
    if (!isIso(v)) return this.err(field, `${label}必须为 ISO8601 时间字符串`);
    return new Date(v).toISOString();
  }
  intArray(field, { required = false, min = 0, max = Infinity, label = field, def } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null) {
      if (required) return this.err(field, `${label}不能为空`);
      return def;
    }
    if (!Array.isArray(v)) return this.err(field, `${label}必须为数组`);
    if (v.length < min) return this.err(field, min === 1 ? `${label}至少包含 1 项` : `${label}至少包含 ${min} 项`);
    if (v.length > max) return this.err(field, `${label}最多 ${max} 项`);
    let ok = true;
    v.forEach((x, i) => {
      if (!Number.isInteger(x) || x < 1) {
        ok = false;
        this.err(`${field}[${i}]`, `${label}[${i}] 必须为正整数`);
      }
    });
    return ok ? [...new Set(v)] : undefined;
  }
  strArray(field, { max = Infinity, itemMax = Infinity, label = field, def = [] } = {}) {
    const v = this.src[field];
    if (v === undefined || v === null) return def;
    if (!Array.isArray(v)) return this.err(field, `${label}必须为数组`);
    if (v.length > max) return this.err(field, `${label}最多 ${max} 个`);
    const out = [];
    let ok = true;
    v.forEach((x, i) => {
      if (typeof x !== 'string' || x.trim() === '') {
        ok = false;
        this.err(`${field}[${i}]`, `${label}[${i}] 不能为空`);
      } else if ([...x.trim()].length > itemMax) {
        ok = false;
        this.err(`${field}[${i}]`, `${label}[${i}] 长度不能超过 ${itemMax}`);
      } else out.push(x.trim());
    });
    return ok ? [...new Set(out)] : undefined;
  }
  check() {
    if (this.errors.length) throw validationError(this.errors);
  }
}

export const v = (src, opts) => new Validator(src, opts);
