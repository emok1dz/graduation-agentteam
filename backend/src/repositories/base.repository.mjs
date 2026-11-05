// BaseRepository：按集合封装增删改查；对外返回深拷贝，内部以不可变方式替换文档
import { nowIso } from '../core/clock.mjs';

export const clone = (x) => (x === null || x === undefined ? x : structuredClone(x));

export function toPredicate(pred) {
  if (!pred) return () => true;
  if (typeof pred === 'function') return pred;
  const entries = Object.entries(pred);
  return (d) => entries.every(([k, v]) => d[k] === v);
}

export class BaseRepository {
  /**
   * @param {import('./json-store.mjs').JsonStore} store
   * @param {string} coll
   * @param {{hasId?: boolean, timestamps?: string[]}} opts
   */
  constructor(store, coll, { hasId = true, timestamps = ['created_at', 'updated_at'] } = {}) {
    this.store = store;
    this.coll = coll;
    this.hasId = hasId;
    this.timestamps = timestamps;
  }
  get _arr() {
    return this.store.data[this.coll];
  }
  /** 内部只读访问（不拷贝），仅供仓储子类做高效遍历 */
  _raw(pred) {
    const p = toPredicate(pred);
    return this._arr.filter(p);
  }
  async findById(id) {
    return clone(this._arr.find((d) => d.id === id) || null);
  }
  async findOne(pred) {
    return clone(this._arr.find(toPredicate(pred)) || null);
  }
  async findMany(pred, { sort } = {}) {
    const list = this._arr.filter(toPredicate(pred)).map(clone);
    if (sort) list.sort(sort);
    return list;
  }
  async count(pred) {
    const p = toPredicate(pred);
    let n = 0;
    for (const d of this._arr) if (p(d)) n++;
    return n;
  }
  async insert(doc) {
    this.store.touch(this.coll);
    const now = nowIso();
    const d = { ...clone(doc) };
    if (this.hasId) d.id = this.store.nextId(this.coll);
    for (const t of this.timestamps) if (d[t] === undefined) d[t] = now;
    const ordered = this.hasId ? { id: d.id, ...d } : d;
    this._arr.push(ordered);
    return clone(ordered);
  }
  async update(id, patch) {
    const idx = this._arr.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    return this._replaceAt(idx, patch);
  }
  async updateWhere(pred, patch) {
    const p = toPredicate(pred);
    let n = 0;
    for (let i = 0; i < this._arr.length; i++) {
      if (p(this._arr[i])) {
        this._replaceAt(i, typeof patch === 'function' ? patch(clone(this._arr[i])) : patch);
        n++;
      }
    }
    return n;
  }
  _replaceAt(idx, patch) {
    this.store.touch(this.coll);
    const next = { ...this._arr[idx], ...clone(patch) };
    if (this.timestamps.includes('updated_at')) next.updated_at = nowIso();
    this._arr[idx] = next;
    return clone(next);
  }
  async remove(id) {
    return this.removeWhere((d) => d.id === id);
  }
  async removeWhere(pred) {
    const p = toPredicate(pred);
    const before = this._arr.length;
    const kept = this._arr.filter((d) => !p(d));
    if (kept.length !== before) {
      this.store.touch(this.coll);
      this.store.data[this.coll] = kept;
    }
    return before - kept.length;
  }
}
