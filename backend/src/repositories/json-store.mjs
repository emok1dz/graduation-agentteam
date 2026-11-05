// JsonStore：内存数据 + 互斥锁（串行事务）+ 写时备份回滚 + 写队列合并 + 原子落盘
import fsp from 'node:fs/promises';
import path from 'node:path';

export const COLLECTIONS = [
  'users', 'sessions', 'classes', 'class_teachers', 'tags', 'questions', 'question_tags',
  'papers', 'paper_questions', 'exams', 'exam_classes', 'submissions', 'answers',
];
export const SEQ_COLLECTIONS = [
  'users', 'sessions', 'classes', 'tags', 'questions', 'paper_questions', 'papers', 'exams', 'submissions', 'answers',
];

export function emptyDb() {
  const db = { meta: { schema_version: 1, seq: {} } };
  for (const c of SEQ_COLLECTIONS) db.meta.seq[c] = 0;
  for (const c of COLLECTIONS) db[c] = [];
  return db;
}

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.tmp = file + '.tmp';
    this.data = null;
    this._lock = Promise.resolve();
    this._tx = null;
    this._next = null; // 排队中的下一次落盘
    this._writing = null; // 正在进行的落盘
    this.writeCount = 0;
  }

  static async open(file) {
    const s = new JsonStore(file);
    await s.load();
    return s;
  }

  async load() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.rm(this.tmp, { force: true });
    let text = null;
    try {
      text = await fsp.readFile(this.file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (text === null) {
      this.data = emptyDb();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`数据文件 ${this.file} 解析失败，拒绝启动（原文件未被修改）：${e.message}`);
    }
    const base = emptyDb();
    parsed.meta = parsed.meta || base.meta;
    parsed.meta.seq = { ...base.meta.seq, ...(parsed.meta.seq || {}) };
    for (const c of COLLECTIONS) if (!Array.isArray(parsed[c])) parsed[c] = [];
    this.data = parsed;
  }

  isEmpty() {
    return COLLECTIONS.every((c) => this.data[c].length === 0);
  }

  /** 互斥执行：同一时刻只有一个 fn 在运行 */
  runExclusive(fn) {
    const run = this._lock.then(() => fn());
    this._lock = run.catch(() => {});
    return run;
  }

  get inTransaction() {
    return this._tx !== null;
  }

  /** 事务：串行执行；fn 抛错时回滚其全部写入；有写入时在落盘完成后才 resolve */
  async transaction(fn) {
    const out = await this.runExclusive(async () => {
      this._tx = { backups: new Map(), seq: null, dirty: false };
      try {
        const result = await fn();
        return { result, dirty: this._tx.dirty };
      } catch (e) {
        this._rollback();
        throw e;
      } finally {
        this._tx = null;
      }
    });
    if (out.dirty) await this.commit();
    return out.result;
  }

  /** 仓储在修改某集合前调用：事务内首次写入时做浅拷贝备份（文档均以不可变方式替换） */
  touch(coll) {
    if (this._tx) {
      if (!this._tx.backups.has(coll)) this._tx.backups.set(coll, this.data[coll].slice());
      this._tx.dirty = true;
    } else {
      // 事务外写入（不推荐）：异步落盘
      this.commit().catch((e) => console.error('[store] commit failed', e));
    }
  }

  nextId(coll) {
    if (this._tx && !this._tx.seq) this._tx.seq = { ...this.data.meta.seq };
    const seq = this.data.meta.seq;
    seq[coll] = (seq[coll] || 0) + 1;
    return seq[coll];
  }

  _rollback() {
    if (!this._tx) return;
    for (const [coll, arr] of this._tx.backups) this.data[coll] = arr;
    if (this._tx.seq) this.data.meta.seq = this._tx.seq;
  }

  /** 请求一次落盘；同一时间窗内的多次请求合并为一次写入 */
  commit() {
    if (!this._next) {
      const prev = this._writing || Promise.resolve();
      this._next = prev
        .catch(() => {})
        .then(() => {
          this._next = null;
          this._writing = this._writeNow();
          return this._writing;
        });
    }
    return this._next;
  }

  async _writeNow() {
    // 在锁内序列化，保证不会写入未完成事务的中间状态
    const text = await this.runExclusive(() => JSON.stringify(this.data, null, 2));
    const fh = await fsp.open(this.tmp, 'w');
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(this.tmp, this.file);
    this.writeCount++;
  }

  async flush() {
    if (this._next) await this._next;
    else if (this._writing) await this._writing;
  }
}
