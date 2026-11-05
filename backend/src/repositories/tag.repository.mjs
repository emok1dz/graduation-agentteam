import { BaseRepository } from './base.repository.mjs';

export class TagRepository extends BaseRepository {
  constructor(store) {
    super(store, 'tags', { timestamps: ['created_at'] });
  }
  listByTeacher(teacherId) {
    return this.findMany({ teacher_id: teacherId }, { sort: (a, b) => a.name.localeCompare(b.name, 'zh-CN') });
  }
  findByName(teacherId, name) {
    return this.findOne((t) => t.teacher_id === teacherId && t.name === name);
  }
  questionCount(tagId) {
    const live = new Set(this.store.data.questions.filter((q) => !q.deleted_at).map((q) => q.id));
    return this.store.data.question_tags.filter((qt) => qt.tag_id === tagId && live.has(qt.question_id)).length;
  }
}
