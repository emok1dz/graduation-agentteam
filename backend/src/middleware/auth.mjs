// 鉴权中间件：Bearer → sha256 → session → user；滑动续期；RBAC
import { fail } from '../core/errors.mjs';

export function createAuth(services) {
  return {
    async authenticate(ctx) {
      const h = ctx.req.headers.authorization || '';
      const m = /^Bearer\s+(\S+)$/i.exec(h);
      if (!m) throw fail('UNAUTHENTICATED');
      const { user, session } = await services.auth.resolveSession(m[1], ctx.now);
      ctx.user = user;
      ctx.session = session;
    },
    requireRole(ctx, roles) {
      if (!roles || roles.includes('public')) return;
      if (!ctx.user || !roles.includes(ctx.user.role)) throw fail('FORBIDDEN_ROLE');
    },
  };
}
