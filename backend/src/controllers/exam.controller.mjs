export default (s) => ({
  listExams: (ctx) => s.exam.list(ctx.user, ctx.query, ctx.now),
  async createExam(ctx) {
    ctx.status = 201;
    return s.exam.create(ctx.user, ctx.body, ctx.now);
  },
  getExam: (ctx) => s.exam.get(ctx.user, ctx.params.id, ctx.now),
  updateExam: (ctx) => s.exam.update(ctx.user, ctx.params.id, ctx.body, ctx.now),
  cancelExam: (ctx) => s.exam.cancel(ctx.user, ctx.params.id, ctx.now),
  getExamMonitor: (ctx) => s.exam.monitor(ctx.user, ctx.params.id, ctx.now),
});
