export default (s) => ({
  getSubmission: (ctx) => s.grading.submissionDetail(ctx.user, ctx.params.id),
  saveAnswers: (ctx) => s.answer.save(ctx.user, ctx.params.id, ctx.body, ctx.now),
  submitSubmission: (ctx) => s.answer.submit(ctx.user, ctx.params.id, ctx.body, ctx.now),
});
