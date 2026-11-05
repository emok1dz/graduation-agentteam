import { BaseRepository } from './base.repository.mjs';

export class PaperRepository extends BaseRepository {
  constructor(store) {
    super(store, 'papers');
    this.pqs = new BaseRepository(store, 'paper_questions', { timestamps: [] });
  }
  listByTeacher(teacherId) {
    return this.findMany({ teacher_id: teacherId }, {
      sort: (a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id),
    });
  }
  listQuestions(paperId) {
    return this.pqs.findMany({ paper_id: paperId }, { sort: (a, b) => a.seq - b.seq });
  }
  findQuestion(pqId) {
    return this.pqs.findById(pqId);
  }
  insertQuestion(pq) {
    return this.pqs.insert(pq);
  }
  updateQuestion(id, patch) {
    return this.pqs.update(id, patch);
  }
  removeQuestions(pred) {
    return this.pqs.removeWhere(pred);
  }
  examRefCount(paperId) {
    return this.store.data.exams.filter((e) => e.paper_id === paperId).length;
  }
}
