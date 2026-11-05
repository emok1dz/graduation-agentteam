export default (s) => ({
  getOverview: (ctx) => s.stat.overview(ctx.now),
});
