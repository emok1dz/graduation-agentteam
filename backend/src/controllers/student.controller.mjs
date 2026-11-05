export default (s) => ({
  listStudentExams: (ctx) => s.answer.listStudentExams(ctx.user, ctx.query, ctx.now),
  getStudentExam: (ctx) => s.answer.getStudentExam(ctx.user, ctx.params.id, ctx.now),
  startExam: (ctx) => s.answer.start(ctx.user, ctx.params.id, ctx.now),
  listStudentResults: (ctx) => s.grading.studentResults(ctx.user, ctx.query, ctx.now),
  getStudentResult: (ctx) => s.grading.studentResult(ctx.user, ctx.params.exam_id, ctx.now),
});
