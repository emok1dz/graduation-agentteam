export default (s) => ({
  listQuestions: (ctx) => s.question.list(ctx.user, ctx.query),
  async createQuestion(ctx) {
    ctx.status = 201;
    return s.question.create(ctx.user, ctx.body);
  },
  importQuestions: (ctx) => s.question.importMany(ctx.user, ctx.body),
  getQuestion: (ctx) => s.question.get(ctx.user, ctx.params.id),
  updateQuestion: (ctx) => s.question.update(ctx.user, ctx.params.id, ctx.body),
  deleteQuestion: (ctx) => s.question.remove(ctx.user, ctx.params.id, ctx.now),
});
