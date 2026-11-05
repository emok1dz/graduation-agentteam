export default (s) => ({
  listTags: (ctx) => s.tag.list(ctx.user),
  async createTag(ctx) {
    ctx.status = 201;
    return s.tag.create(ctx.user, ctx.body);
  },
  renameTag: (ctx) => s.tag.rename(ctx.user, ctx.params.id, ctx.body),
  deleteTag: (ctx) => s.tag.remove(ctx.user, ctx.params.id),
});
