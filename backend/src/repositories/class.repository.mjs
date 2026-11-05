import { BaseRepository } from './base.repository.mjs';

export class ClassRepository extends BaseRepository {
  constructor(store) {
    super(store, 'classes');
    this.links = new BaseRepository(store, 'class_teachers', { hasId: false, timestamps: ['created_at'] });
  }
  findByName(name) {
    return this.findOne({ name });
  }
  async listTeacherIds(classId) {
    return this.links._raw({ class_id: classId }).map((l) => l.teacher_id);
  }
  async setTeachers(classId, teacherIds) {
    await this.links.removeWhere({ class_id: classId });
    for (const tid of teacherIds) await this.links.insert({ class_id: classId, teacher_id: tid });
  }
  async listClassIdsByTeacher(teacherId) {
    return this.links._raw({ teacher_id: teacherId }).map((l) => l.class_id);
  }
  async teaches(teacherId, classId) {
    return this.links._raw((l) => l.teacher_id === teacherId && l.class_id === classId).length > 0;
  }
  removeTeacherLinks(pred) {
    return this.links.removeWhere(pred);
  }
}
