export default (s) => ({
  listClasses: (ctx) => s.class.list(ctx.user, ctx.query),
  async createClass(ctx) {
    ctx.status = 201;
    return s.class.create(ctx.body);
  },
  getClass: (ctx) => s.class.get(ctx.user, ctx.params.id),
  updateClass: (ctx) => s.class.update(ctx.params.id, ctx.body),
  deleteClass: (ctx) => s.class.remove(ctx.params.id),
  getClassMembers: (ctx) => s.class.members(ctx.user, ctx.params.id),
  addClassStudents: (ctx) => s.class.addStudents(ctx.params.id, ctx.body),
  removeClassStudents: (ctx) => s.class.removeStudents(ctx.params.id, ctx.body),
  setClassTeachers: (ctx) => s.class.setTeachers(ctx.params.id, ctx.body),
});
