export default (s) => ({
  listUsers: (ctx) => s.user.list(ctx.query),
  async createUser(ctx) {
    ctx.status = 201;
    return s.user.create(ctx.body);
  },
  getUser: (ctx) => s.user.get(ctx.params.id),
  updateUser: (ctx) => s.user.update(ctx.user, ctx.params.id, ctx.body),
  deleteUser: (ctx) => s.user.remove(ctx.user, ctx.params.id),
  resetUserPassword: (ctx) => s.user.resetPassword(ctx.params.id),
});
