export default (s) => ({
  listPapers: (ctx) => s.paper.list(ctx.user, ctx.query),
  async createPaper(ctx) {
    ctx.status = 201;
    return s.paper.create(ctx.user, ctx.body);
  },
  generateRandomPaper: (ctx) => s.paper.generate(ctx.user, ctx.body),
  replaceRandomQuestion: (ctx) => s.paper.replace(ctx.user, ctx.body),
  getPaper: (ctx) => s.paper.get(ctx.user, ctx.params.id),
  updatePaper: (ctx) => s.paper.update(ctx.user, ctx.params.id, ctx.body),
  deletePaper: (ctx) => s.paper.remove(ctx.user, ctx.params.id),
  async copyPaper(ctx) {
    ctx.status = 201;
    return s.paper.copy(ctx.user, ctx.params.id, ctx.body);
  },
});
