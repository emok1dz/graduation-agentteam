import { BaseRepository } from './base.repository.mjs';

export class QuestionRepository extends BaseRepository {
  constructor(store) {
    super(store, 'questions');
    this.qtags = new BaseRepository(store, 'question_tags', { hasId: false, timestamps: [] });
  }
  listByTeacher(teacherId) {
    return this.findMany((q) => q.teacher_id === teacherId && !q.deleted_at, {
      sort: (a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id),
    });
  }
  async setTags(questionId, tagIds) {
    await this.qtags.removeWhere({ question_id: questionId });
    for (const tag_id of tagIds) await this.qtags.insert({ question_id: questionId, tag_id });
  }
  /** 一次性构建 question_id → [tag name] 映射 */
  tagNameMap() {
    const tagName = new Map(this.store.data.tags.map((t) => [t.id, t.name]));
    const m = new Map();
    for (const qt of this.store.data.question_tags) {
      const n = tagName.get(qt.tag_id);
      if (n === undefined) continue;
      if (!m.has(qt.question_id)) m.set(qt.question_id, []);
      m.get(qt.question_id).push(n);
    }
    return m;
  }
  tagNamesOf(questionId) {
    return this.tagNameMap().get(questionId) || [];
  }
  /** question_id → 被多少份试卷引用 */
  refCountMap() {
    const m = new Map();
    const seen = new Set();
    for (const pq of this.store.data.paper_questions) {
      if (pq.question_id == null) continue;
      const k = `${pq.paper_id}:${pq.question_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      m.set(pq.question_id, (m.get(pq.question_id) || 0) + 1);
    }
    return m;
  }
  refCount(questionId) {
    return this.refCountMap().get(questionId) || 0;
  }
  removeTagLinks(pred) {
    return this.qtags.removeWhere(pred);
  }
}
