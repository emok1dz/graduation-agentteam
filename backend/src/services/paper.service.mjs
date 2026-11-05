// 组卷：保存（快照、分组排序）、随机生成/替换、锁定检查、复制
import { fail, validationError } from '../core/errors.mjs';
import { Validator, isPlainObject, isScore1 } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';
import { TYPE_ORDER, QUESTION_TYPES, DIFFICULTIES } from '../domain/question-rules.mjs';
import { drawByRules, pickRandom, matchesRule, shortageMessage } from '../domain/random-picker.mjs';
import { round1 } from '../domain/scoring.mjs';

const SNAP_FIELDS = ['type', 'stem', 'options', 'answer', 'analysis', 'difficulty', 'blank_count'];

export function createPaperService({ repos, svc }) {
  function summary(p) {
    const refs = repos.papers.examRefCount(p.id);
    return {
      id: p.id, title: p.title, description: p.description ?? '', question_count: p.question_count,
      total_score: p.total_score, exam_ref_count: refs, locked: refs > 0, created_at: p.created_at, updated_at: p.updated_at,
    };
  }
  async function detail(p) {
    const pqs = await repos.papers.listQuestions(p.id);
    const stats = new Map();
    for (const pq of pqs) {
      const s = stats.get(pq.type) || { type: pq.type, count: 0, score: 0 };
      s.count++;
      s.score = round1(s.score + pq.score);
      stats.set(pq.type, s);
    }
    return {
      ...summary(p),
      type_stats: [...stats.values()].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]),
      questions: pqs.map(pqView),
    };
  }
  const pqView = (pq) => ({
    id: pq.id, seq: pq.seq, question_id: pq.question_id ?? null, type: pq.type, stem: pq.stem, options: pq.options,
    answer: pq.answer, analysis: pq.analysis, difficulty: pq.difficulty, tags: pq.tags || [], score: pq.score, blank_count: pq.blank_count,
  });
  async function ownOr404(user, id, repo = repos) {
    const p = await repo.papers.findById(id);
    if (!p) throw fail('NOT_FOUND', '试卷不存在');
    if (p.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER');
    return p;
  }
  function parseInput(body) {
    const vd = new Validator(body);
    const title = vd.str('title', { required: true, min: 1, max: 100, label: '试卷名称' });
    const description = vd.str('description', { max: 500, def: '', label: '试卷说明' }) ?? '';
    const items = body?.items;
    let out = [];
    if (!Array.isArray(items)) vd.err('items', '题目列表必须为数组');
    else if (items.length < 1) vd.err('items', '试卷至少包含 1 道题');
    else if (items.length > 200) vd.err('items', '试卷最多 200 道题');
    else {
      const seen = new Set();
      items.forEach((it, i) => {
        if (!isPlainObject(it)) return vd.err(`items[${i}]`, '题目项格式不正确');
        if (!Number.isInteger(it.question_id) || it.question_id < 1) vd.err(`items[${i}].question_id`, '题目 ID 必须为正整数');
        else if (seen.has(it.question_id)) vd.err(`items[${i}].question_id`, '同一题不得重复加入');
        else seen.add(it.question_id);
        if (typeof it.score !== 'number' || !isScore1(it.score) || it.score <= 0 || it.score > 100)
          vd.err(`items[${i}].score`, '分值必须为 0~100 之间的正数且最多 1 位小数');
        out.push({ question_id: it.question_id, score: round1(it.score) });
      });
    }
    vd.check();
    return { title, description, items: out };
  }
  /** 事务内：校验题目归属并生成排序后的快照项；existing: Map<question_id, pq>（编辑时沿用快照） */
  async function buildItemsTx(tx, user, items, existing = new Map()) {
    const tagMap = tx.questions.tagNameMap();
    const errs = [];
    let foreign = false;
    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const old = existing.get(it.question_id);
      if (old) {
        rows.push({ idx: i, type: old.type, reuse: old, score: it.score });
        continue;
      }
      const q = await tx.questions.findById(it.question_id);
      if (!q || q.deleted_at) {
        errs.push({ field: `items[${i}].question_id`, message: `题目 ${it.question_id} 不存在或已删除` });
        continue;
      }
      if (q.teacher_id !== user.id) {
        foreign = true;
        continue;
      }
      const snap = Object.fromEntries(SNAP_FIELDS.map((f) => [f, structuredClone(q[f])]));
      rows.push({ idx: i, type: q.type, snap: { ...snap, question_id: q.id, tags: tagMap.get(q.id) || [] }, score: it.score });
    }
    if (errs.length) throw validationError(errs);
    if (foreign) throw fail('FORBIDDEN_OWNER', '只能使用本人题库中的题目');
    rows.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.idx - b.idx);
    rows.forEach((r, i) => (r.seq = i + 1));
    return rows;
  }
  async function writeItemsTx(tx, paperId, rows) {
    for (const r of rows) {
      if (r.reuse) await tx.papers.updateQuestion(r.reuse.id, { seq: r.seq, score: r.score });
      else await tx.papers.insertQuestion({ paper_id: paperId, seq: r.seq, ...r.snap, score: r.score });
    }
    const total = round1(rows.reduce((s, r) => s + r.score, 0));
    return tx.papers.update(paperId, { total_score: total, question_count: rows.length });
  }
  function parseRule(vd, r, prefix) {
    const sub = new Validator(r, { prefix });
    const rule = {
      type: sub.enum('type', QUESTION_TYPES, { required: true, label: '题型' }),
      difficulty: sub.enum('difficulty', DIFFICULTIES, { nullable: true, label: '难度' }) ?? null,
      tags: sub.strArray('tags', { itemMax: 20, label: '标签' }) || [],
    };
    vd.errors.push(...sub.errors);
    return { rule, sub };
  }

  return {
    summary,
    detail,
    async list(user, query) {
      const vd = new Validator(query, { query: true });
      const keyword = vd.str('keyword', { max: 50 });
      vd.check();
      const pg = parsePage(query);
      const kw = keyword ? keyword.toLowerCase() : null;
      const list = (await repos.papers.listByTeacher(user.id)).filter((p) => !kw || p.title.toLowerCase().includes(kw));
      const page = paginate(list, pg);
      page.items = page.items.map(summary);
      return page;
    },
    async create(user, body) {
      const input = parseInput(body);
      const p = await repos.transaction(async (tx) => {
        const rows = await buildItemsTx(tx, user, input.items);
        const paper = await tx.papers.insert({
          teacher_id: user.id, title: input.title, description: input.description, total_score: 0, question_count: 0,
        });
        return writeItemsTx(tx, paper.id, rows);
      });
      return detail(p);
    },
    async generate(user, body, rng) {
      const vd = new Validator(body);
      const raw = body?.rules;
      const rules = [];
      if (!Array.isArray(raw)) vd.err('rules', '抽题规则必须为数组');
      else if (raw.length < 1 || raw.length > 20) vd.err('rules', '抽题规则须为 1~20 条');
      else
        raw.forEach((r, i) => {
          if (!isPlainObject(r)) return vd.err(`rules[${i}]`, '规则格式不正确');
          const { rule, sub } = parseRule(vd, r, `rules[${i}]`);
          rule.count = sub.int('count', { required: true, min: 1, max: 100, label: '数量' });
          rule.score = sub.score('score', { required: true, gt: true, min: 0, max: 100, label: '每题分值' });
          vd.errors.push(...sub.errors.filter((e) => !vd.errors.includes(e)));
          rules.push(rule);
        });
      vd.check();
      const pool = await svc.question.ownQuestionsWithTags(user.id);
      const res = drawByRules(pool, rules, rng);
      if (res.shortages) {
        throw fail('INSUFFICIENT_QUESTIONS', res.shortages.map(shortageMessage).join('；'), { shortages: res.shortages });
      }
      const items = res.items.map((it) => ({ rule_index: it.rule_index, score: it.score, question: svc.question.toView(it.question) }));
      return { items, total_score: round1(items.reduce((s, it) => s + it.score, 0)) };
    },
    async replace(user, body, rng) {
      const vd = new Validator(body);
      const { rule } = isPlainObject(body) ? parseRule(vd, body, '') : { rule: {} };
      if (!isPlainObject(body)) vd.err('type', '题型不能为空');
      const ex = vd.intArray('exclude_question_ids', { required: true, min: 0, label: '排除题目' }) || [];
      vd.check();
      const exclude = new Set(ex);
      const pool = (await svc.question.ownQuestionsWithTags(user.id)).filter((q) => !exclude.has(q.id) && matchesRule(q, rule));
      if (!pool.length) {
        const s = { rule_index: 0, type: rule.type, difficulty: rule.difficulty, tags: rule.tags, available: 0, required: 1 };
        throw fail('INSUFFICIENT_QUESTIONS', shortageMessage(s), { shortages: [s] });
      }
      return svc.question.toView(pickRandom(pool, 1, rng)[0]);
    },
    async get(user, id) {
      return detail(await ownOr404(user, id));
    },
    async update(user, id, body) {
      const input = parseInput(body);
      const p = await repos.transaction(async (tx) => {
        await ownOr404(user, id, tx);
        if (tx.papers.examRefCount(id) > 0) throw fail('PAPER_LOCKED');
        const old = await tx.papers.listQuestions(id);
        const existing = new Map(old.filter((pq) => pq.question_id != null).map((pq) => [pq.question_id, pq]));
        const rows = await buildItemsTx(tx, user, input.items, existing);
        const keep = new Set(rows.filter((r) => r.reuse).map((r) => r.reuse.id));
        await tx.papers.removeQuestions((pq) => pq.paper_id === id && !keep.has(pq.id));
        await tx.papers.update(id, { title: input.title, description: input.description });
        return writeItemsTx(tx, id, rows);
      });
      return detail(p);
    },
    async remove(user, id) {
      await repos.transaction(async (tx) => {
        await ownOr404(user, id, tx);
        if (tx.papers.examRefCount(id) > 0) throw fail('PAPER_LOCKED');
        await tx.papers.removeQuestions({ paper_id: id });
        await tx.papers.remove(id);
      });
      return null;
    },
    async copy(user, id, body) {
      const vd = new Validator(body || {});
      const title = vd.str('title', { min: 1, max: 100, label: '试卷名称' });
      vd.check();
      const p = await repos.transaction(async (tx) => {
        const src = await ownOr404(user, id, tx);
        const pqs = await tx.papers.listQuestions(id);
        const np = await tx.papers.insert({
          teacher_id: user.id, title: title || `${src.title}（副本）`.slice(0, 100), description: src.description ?? '',
          total_score: src.total_score, question_count: src.question_count,
        });
        for (const pq of pqs) {
          const { id: _id, paper_id: _p, ...rest } = pq;
          await tx.papers.insertQuestion({ ...rest, paper_id: np.id });
        }
        return np;
      });
      return detail(p);
    },
  };
}
