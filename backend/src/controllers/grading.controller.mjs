export default (s) => ({
  gradeSubmission: (ctx) => s.grading.grade(ctx.user, ctx.params.id, ctx.body, ctx.now),
  getGradingOverview: (ctx) => s.grading.overview(ctx.user, ctx.params.id, ctx.now),
  getGradingByQuestion: (ctx) => s.grading.byQuestion(ctx.user, ctx.params.id, ctx.params.paper_question_id, ctx.now),
  publishResults: (ctx) => s.grading.publish(ctx.user, ctx.params.id, ctx.body, ctx.now),
  unpublishResults: (ctx) => s.grading.unpublish(ctx.user, ctx.params.id, ctx.now),
});
