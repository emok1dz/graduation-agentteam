// 题库：CRUD（逻辑删除）、检索+汇总、批量导入；assertOwnQuestion
import { fail, validationError } from '../core/errors.mjs';
import { Validator, isPlainObject } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';
import { validateQuestionInput, QUESTION_TYPES, DIFFICULTIES } from '../domain/question-rules.mjs';

export function createQuestionService({ repos, svc }) {
  function view(q, tagMap, refMap) {
    return {
      id: q.id, type: q.type, stem: q.stem, options: q.options, answer: q.answer, analysis: q.analysis,
      difficulty: q.difficulty, tags: tagMap.get(q.id) || [], score: q.score, blank_count: q.blank_count,
      ref_count: refMap.get(q.id) || 0, created_at: q.created_at, updated_at: q.updated_at,
    };
  }
  const maps = () => ({ tagMap: repos.questions.tagNameMap(), refMap: repos.questions.refCountMap() });
  const toView = (q) => {
    const { tagMap, refMap } = maps();
    return view(q, tagMap, refMap);
  };
  async function ownOr404(user, id, repo = repos) {
    const q = await repo.questions.findById(id);
    if (!q || q.deleted_at) throw fail('NOT_FOUND', '题目不存在');
    if (q.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER');
    return q;
  }
  async function insertTx(tx, user, value) {
    const { tags, ...rest } = value;
    const q = await tx.questions.insert({ teacher_id: user.id, ...rest, deleted_at: null });
    const tagIds = await svc.tag.ensureTagsTx(tx, user.id, tags);
    await tx.questions.setTags(q.id, tagIds);
    return q;
  }

  const self = {
    toView,
    /** 本人未删除题目（附 tags 名称数组），供组卷使用 */
    async ownQuestionsWithTags(teacherId) {
      const tagMap = repos.questions.tagNameMap();
      return (await repos.questions.listByTeacher(teacherId)).map((q) => ({ ...q, tags: tagMap.get(q.id) || [] }));
    },
    async list(user, query) {
      const vd = new Validator(query, { query: true });
      const type = vd.enum('type', QUESTION_TYPES, { label: '题型' });
      const difficulty = vd.enum('difficulty', DIFFICULTIES, { label: '难度' });
      const keyword = vd.str('keyword', { max: 50, label: '关键字' });
      const tagsRaw = vd.str('tags', { max: 500 });
      const exRaw = vd.str('exclude_ids', { max: 5000 });
      let exclude = new Set();
      if (exRaw) {
        const parts = exRaw.split(',').map((s) => s.trim()).filter(Boolean);
        if (!parts.every((p) => /^\d+$/.test(p))) vd.err('exclude_ids', 'exclude_ids 必须为逗号分隔的整数');
        else exclude = new Set(parts.map(Number));
      }
      vd.check();
      const pg = parsePage(query);
      const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const { tagMap, refMap } = maps();
      const kw = keyword ? keyword.toLowerCase() : null;
      const list = (await repos.questions.listByTeacher(user.id)).filter((q) => {
        if (type && q.type !== type) return false;
        if (difficulty && q.difficulty !== difficulty) return false;
        if (kw && !q.stem.toLowerCase().includes(kw)) return false;
        if (exclude.has(q.id)) return false;
        if (tags.length && !(tagMap.get(q.id) || []).some((t) => tags.includes(t))) return false;
        return true;
      });
      const by_type = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0]));
      const by_difficulty = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0]));
      for (const q of list) {
        by_type[q.type]++;
        by_difficulty[q.difficulty]++;
      }
      const page = paginate(list, pg);
      page.items = page.items.map((q) => view(q, tagMap, refMap));
      page.summary = { by_type, by_difficulty };
      return page;
    },
    async create(user, body) {
      const { errors, value } = validateQuestionInput(body);
      if (errors.length) throw validationError(errors);
      const q = await repos.transaction((tx) => insertTx(tx, user, value));
      return toView(q);
    },
    async importMany(user, body) {
      if (!isPlainObject(body) || !Array.isArray(body.questions)) throw validationError([{ field: 'questions', message: 'questions 必须为数组' }]);
      const qs = body.questions;
      if (qs.length < 1) throw validationError([{ field: 'questions', message: '至少导入 1 题' }]);
      if (qs.length > 200) throw validationError([{ field: 'questions', message: '单次最多导入 200 题' }]);
      const failures = [];
      const ok = [];
      qs.forEach((item, index) => {
        const { errors, value } = validateQuestionInput(item);
        if (errors.length) failures.push({ index, errors });
        else ok.push(value);
      });
      if (ok.length) await repos.transaction(async (tx) => {
        for (const v of ok) await insertTx(tx, user, v);
      });
      return { success_count: ok.length, fail_count: failures.length, failures };
    },
    async get(user, id) {
      return toView(await ownOr404(user, id));
    },
    async update(user, id, body) {
      const { errors, value } = validateQuestionInput(body);
      if (errors.length) throw validationError(errors);
      const q = await repos.transaction(async (tx) => {
        await ownOr404(user, id, tx);
        const { tags, ...rest } = value;
        const updated = await tx.questions.update(id, rest);
        await tx.questions.setTags(id, await svc.tag.ensureTagsTx(tx, user.id, tags));
        return updated;
      });
      return toView(q);
    },
    async remove(user, id, now) {
      return repos.transaction(async (tx) => {
        await ownOr404(user, id, tx);
        await tx.questions.update(id, { deleted_at: now.toISOString() });
        return { id, ref_count: tx.questions.refCount(id) };
      });
    },
  };
  return self;
}
