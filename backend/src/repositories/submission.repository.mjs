import { BaseRepository } from './base.repository.mjs';

export class SubmissionRepository extends BaseRepository {
  constructor(store) {
    super(store, 'submissions');
    this.answers = new BaseRepository(store, 'answers');
  }
  findByExamStudent(examId, studentId) {
    return this.findOne((s) => s.exam_id === examId && s.student_id === studentId);
  }
  listByExam(examId) {
    return this.findMany({ exam_id: examId });
  }
  listByStudent(studentId) {
    return this.findMany({ student_id: studentId });
  }
  /** 已超过 deadline + 宽限仍为作答中的答卷 */
  listExpired(cutoffIso, examId) {
    return this.findMany(
      (s) => s.status === 'in_progress' && s.deadline_at && s.deadline_at < cutoffIso && (examId === undefined || s.exam_id === examId),
    );
  }
  answersOf(subId) {
    return this.answers.findMany({ submission_id: subId });
  }
  answersOfMany(subIds) {
    const set = new Set(subIds);
    return this.answers.findMany((a) => set.has(a.submission_id));
  }
  insertAnswer(a) {
    return this.answers.insert(a);
  }
  updateAnswer(id, patch) {
    return this.answers.update(id, patch);
  }
  /** 增量覆盖作答：items = [{paper_question_id, response}] */
  async upsertAnswers(subId, items) {
    const existing = new Map(this.answers._raw({ submission_id: subId }).map((a) => [a.paper_question_id, a]));
    for (const it of items) {
      const cur = existing.get(it.paper_question_id);
      if (cur) await this.answers.update(cur.id, { response: it.response });
      else
        await this.answers.insert({
          submission_id: subId, paper_question_id: it.paper_question_id, response: it.response,
          score: null, is_correct: null, comment: null, graded_by: null, graded_at: null,
        });
    }
  }
  countAll(pred) {
    return this.count(pred);
  }
}
