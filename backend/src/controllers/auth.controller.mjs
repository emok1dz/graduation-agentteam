import { Validator } from '../core/validator.mjs';

export default (s) => ({
  async login(ctx) {
    const vd = new Validator(ctx.body);
    const username = vd.str('username', { required: true, min: 1, max: 20, label: '账号' });
    const password = vd.str('password', { required: true, min: 1, max: 64, trim: false, label: '密码' });
    vd.check();
    return s.auth.login(username, password, ctx.now);
  },
  logout: (ctx) => s.auth.logout(ctx.session),
  getMe: (ctx) => s.user.toUserView(ctx.user),
  changePassword: (ctx) => s.auth.changePassword(ctx.user, ctx.session, ctx.body),
});
