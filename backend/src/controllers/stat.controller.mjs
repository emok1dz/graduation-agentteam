import { sendCsv } from '../core/http.mjs';

export default (s) => ({
  getScoreSheet: (ctx) => s.stat.scoreSheet(ctx.user, ctx.params.id, ctx.query, ctx.now),
  async exportScoreSheet(ctx) {
    const { filename, text } = await s.stat.exportCsv(ctx.user, ctx.params.id, ctx.query, ctx.now);
    sendCsv(ctx.res, filename, text);
    ctx.handled = true;
  },
  getStatsSummary: (ctx) => s.stat.summary(ctx.user, ctx.params.id, ctx.query, ctx.now),
  getStatsDistribution: (ctx) => s.stat.distribution(ctx.user, ctx.params.id, ctx.query, ctx.now),
  getStatsQuestions: (ctx) => s.stat.questions(ctx.user, ctx.params.id, ctx.query, ctx.now),
});
