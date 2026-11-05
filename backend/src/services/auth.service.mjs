// 认证与会话：登录（锁定策略）、退出、改密、会话解析（滑动续期）
import { fail, validationError } from '../core/errors.mjs';
import { hashPassword, verifyPassword, dummyVerify, checkPasswordPolicy } from '../domain/password.mjs';
import { generateToken, hashToken } from '../domain/token.mjs';

export function createAuthService({ repos, config, svc }) {
  return {
    async login(username, password, now) {
      const t = now.getTime();
      const u0 = await repos.users.findByUsername(username);
      if (!u0) {
        await dummyVerify(password);
        throw fail('LOGIN_FAILED');
      }
      if (u0.locked_until && Date.parse(u0.locked_until) > t) {
        throw fail('ACCOUNT_LOCKED', undefined, { locked_until: u0.locked_until });
      }
      // 慢哈希在事务外计算，避免阻塞其他事务
      const ok = await verifyPassword(password, u0.password_hash, u0.password_salt);
      const r = await repos.transaction(async (tx) => {
        const u = await tx.users.findById(u0.id);
        if (!u) return { err: fail('LOGIN_FAILED') };
        if (u.locked_until && Date.parse(u.locked_until) > t) {
          return { err: fail('ACCOUNT_LOCKED', undefined, { locked_until: u.locked_until }) };
        }
        if (!ok) {
          const cnt = (u.failed_login_count || 0) + 1;
          if (cnt >= config.LOGIN_MAX_FAILS) {
            const until = new Date(t + config.LOGIN_LOCK_MS).toISOString();
            await tx.users.update(u.id, { failed_login_count: 0, locked_until: until });
            return { err: fail('ACCOUNT_LOCKED', undefined, { locked_until: until }) };
          }
          await tx.users.update(u.id, { failed_login_count: cnt });
          return { err: fail('LOGIN_FAILED') };
        }
        if (u.status === 'disabled') return { err: fail('ACCOUNT_DISABLED') };
        if (u.failed_login_count || u.locked_until) await tx.users.update(u.id, { failed_login_count: 0, locked_until: null });
        const token = generateToken();
        const nowIso = now.toISOString();
        const expires_at = new Date(t + config.SESSION_IDLE_MS).toISOString();
        await tx.sessions.insert({ token_hash: hashToken(token), user_id: u.id, created_at: nowIso, last_active_at: nowIso, expires_at });
        return { data: { token, expires_at, user: await svc.user.toUserView(u) } };
      });
      if (r.err) throw r.err;
      return r.data;
    },

    async logout(session) {
      await repos.transaction((tx) => tx.sessions.remove(session.id));
      return null;
    },

    /** Bearer token → {user, session}；失败抛 40100 */
    async resolveSession(token, now) {
      if (!token || !/^[0-9a-f]{64}$/i.test(token)) throw fail('UNAUTHENTICATED');
      const nowIso = now.toISOString();
      const session = await repos.sessions.findByTokenHash(hashToken(token));
      if (!session) throw fail('UNAUTHENTICATED');
      if (session.expires_at <= nowIso) {
        await repos.transaction((tx) => tx.sessions.remove(session.id));
        throw fail('UNAUTHENTICATED');
      }
      const user = await repos.users.findById(session.user_id);
      if (!user || user.status !== 'active') throw fail('UNAUTHENTICATED');
      if (now.getTime() - Date.parse(session.last_active_at) >= config.SESSION_TOUCH_MS) {
        const patch = { last_active_at: nowIso, expires_at: new Date(now.getTime() + config.SESSION_IDLE_MS).toISOString() };
        await repos.transaction((tx) => tx.sessions.update(session.id, patch));
        Object.assign(session, patch);
      }
      return { user, session };
    },

    async changePassword(user, session, body) {
      const b = body && typeof body === 'object' ? body : {};
      const errors = [];
      const { old_password, new_password, confirm_password } = b;
      if (typeof old_password !== 'string' || old_password.length < 1) errors.push({ field: 'old_password', message: '原密码不能为空' });
      else if (old_password.length > 64) errors.push({ field: 'old_password', message: '原密码长度不能超过 64' });
      const pe = checkPasswordPolicy(new_password);
      if (pe) errors.push({ field: 'new_password', message: pe });
      else if (typeof old_password === 'string' && new_password === old_password) errors.push({ field: 'new_password', message: '新密码不能与原密码相同' });
      if (confirm_password !== new_password) errors.push({ field: 'confirm_password', message: '两次输入的新密码不一致' });
      if (errors.length) throw validationError(errors);
      const ok = await verifyPassword(old_password, user.password_hash, user.password_salt);
      if (!ok) throw fail('OLD_PASSWORD_WRONG');
      const { hash, salt } = await hashPassword(new_password);
      await repos.transaction(async (tx) => {
        await tx.users.update(user.id, { password_hash: hash, password_salt: salt });
        await tx.sessions.removeByUser(user.id, session.id);
      });
      return null;
    },

    cleanExpiredSessions(now) {
      return repos.transaction((tx) => tx.sessions.removeExpired(now.toISOString()));
    },
  };
}
