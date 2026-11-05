import { BaseRepository } from './base.repository.mjs';

const byStartDesc = (a, b) => (b.start_time < a.start_time ? -1 : b.start_time > a.start_time ? 1 : b.id - a.id);

export class ExamRepository extends BaseRepository {
  constructor(store) {
    super(store, 'exams');
    this.links = new BaseRepository(store, 'exam_classes', { hasId: false, timestamps: [] });
  }
  listByTeacher(teacherId) {
    return this.findMany({ teacher_id: teacherId }, { sort: byStartDesc });
  }
  listAll() {
    return this.findMany(null, { sort: byStartDesc });
  }
  async classIdsOf(examId) {
    return this.links._raw({ exam_id: examId }).map((l) => l.class_id);
  }
  async setClasses(examId, classIds) {
    await this.links.removeWhere({ exam_id: examId });
    for (const class_id of classIds) await this.links.insert({ exam_id: examId, class_id });
  }
  async listByClass(classId) {
    const ids = new Set(this.links._raw({ class_id: classId }).map((l) => l.exam_id));
    return this.findMany((e) => ids.has(e.id), { sort: byStartDesc });
  }
  async countByClass(classId) {
    return this.links._raw({ class_id: classId }).length;
  }
}
