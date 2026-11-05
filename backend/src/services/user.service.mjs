// 用户管理：CRUD、禁用即踢下线、重置密码、删除前引用检查
import { fail } from '../core/errors.mjs';
import { Validator } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';
import { hashPassword, checkPasswordPolicy } from '../domain/password.mjs';

const ROLES = ['admin', 'teacher', 'student'];

export function createUserService({ repos, config }) {
  async function classNameMap() {
    const list = await repos.classes.findMany();
    return new Map(list.map((c) => [c.id, c.name]));
  }
  function view(u, cmap) {
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      class_id: u.class_id ?? null,
      class_name: u.class_id != null ? cmap.get(u.class_id) ?? null : null,
      status: u.status,
      created_at: u.created_at,
      updated_at: u.updated_at,
    };
  }

  const svc = {
    async toUserView(u, cmap) {
      return view(u, cmap || (await classNameMap()));
    },

    async list(query) {
      const vd = new Validator(query, { query: true });
      const role = vd.enum('role', ROLES);
      const class_id = vd.int('class_id', { min: 1 });
      const status = vd.enum('status', ['active', 'disabled']);
      const keyword = vd.str('keyword', { max: 50 });
      vd.check();
      const pg = parsePage(query);
      const list = await repos.users.listFiltered({ role, class_id, status, keyword });
      const cmap = await classNameMap();
      const page = paginate(list, pg);
      page.items = page.items.map((u) => view(u, cmap));
      return page;
    },

    async create(body) {
      const vd = new Validator(body);
      const username = vd.str('username', {
        required: true, pattern: /^[A-Za-z0-9_]{4,20}$/, label: '账号', patternMsg: '账号须为 4~20 位字母、数字或下划线',
      });
      const name = vd.str('name', { required: true, min: 1, max: 20, label: '姓名' });
      const role = vd.enum('role', ROLES, { required: true, label: '角色' });
      let password = body?.password;
      if (password === undefined || password === null || password === '') password = null;
      else {
        const pe = checkPasswordPolicy(password);
        if (pe) vd.err('password', pe);
      }
      let class_id = vd.int('class_id', { min: 1, nullable: true, label: '班级' }) ?? null;
      if (role === 'student' && class_id === null && !vd.errors.some((e) => e.field === 'class_id')) vd.err('class_id', '学生必须指定所属班级');
      if (role && role !== 'student') class_id = null;
      vd.check();
      const { hash, salt } = await hashPassword(password ?? config.DEFAULT_PASSWORD);
      const r = await repos.transaction(async (tx) => {
        if (await tx.users.findByUsername(username)) throw fail('DUPLICATE', '账号已存在');
        if (class_id !== null && !(await tx.classes.findById(class_id))) throw fail('NOT_FOUND', '班级不存在');
        return tx.users.insert({
          username, name, role, class_id, status: 'active', password_hash: hash, password_salt: salt,
          failed_login_count: 0, locked_until: null,
        });
      });
      return svc.toUserView(r);
    },

    async get(id) {
      const u = await repos.users.findById(id);
      if (!u) throw fail('NOT_FOUND', '用户不存在');
      return svc.toUserView(u);
    },

    async update(actor, id, body) {
      const vd = new Validator(body);
      const name = vd.str('name', { min: 1, max: 20, label: '姓名', required: false });
      if (body && body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '') && !vd.errors.length) vd.err('name', '姓名不能为空');
      const hasClass = body && Object.prototype.hasOwnProperty.call(body, 'class_id');
      const class_id = vd.int('class_id', { min: 1, nullable: true, label: '班级' });
      const status = vd.enum('status', ['active', 'disabled'], { label: '状态' });
      vd.check();
      const r = await repos.transaction(async (tx) => {
        const u = await tx.users.findById(id);
        if (!u) throw fail('NOT_FOUND', '用户不存在');
        const patch = {};
        if (name !== undefined) patch.name = name;
        if (hasClass && u.role === 'student') {
          if (class_id !== null && class_id !== undefined && !(await tx.classes.findById(class_id))) throw fail('NOT_FOUND', '班级不存在');
          patch.class_id = class_id ?? null;
        }
        if (status !== undefined && status !== u.status) {
          if (status === 'disabled' && u.id === actor.id) throw fail('SELF_OPERATION', '不能禁用自己');
          patch.status = status;
          if (status === 'disabled') await tx.sessions.removeByUser(u.id);
        }
        return Object.keys(patch).length ? tx.users.update(id, patch) : u;
      });
      return svc.toUserView(r);
    },

    async remove(actor, id) {
      await repos.transaction(async (tx) => {
        const u = await tx.users.findById(id);
        if (!u) throw fail('NOT_FOUND', '用户不存在');
        if (u.id === actor.id) throw fail('SELF_OPERATION', '不能删除自己');
        if (u.role === 'student' && (await tx.submissions.count({ student_id: id })) > 0) {
          throw fail('RESOURCE_IN_USE', '该学生已产生答卷，不能删除（可禁用）');
        }
        if (u.role === 'teacher') {
          const q = await tx.questions.count({ teacher_id: id });
          const e = await tx.exams.count({ teacher_id: id });
          const p = await tx.papers.count({ teacher_id: id });
          if (q + e + p > 0) throw fail('RESOURCE_IN_USE', '该教师已创建题目、试卷或考试，不能删除（可禁用）');
          const tagIds = new Set((await tx.tags.findMany({ teacher_id: id })).map((t) => t.id));
          await tx.questions.removeTagLinks((qt) => tagIds.has(qt.tag_id));
          await tx.tags.removeWhere({ teacher_id: id });
          await tx.classes.removeTeacherLinks({ teacher_id: id });
        }
        await tx.sessions.removeByUser(id);
        await tx.users.remove(id);
      });
      return null;
    },

    async resetPassword(id) {
      const { hash, salt } = await hashPassword(config.DEFAULT_PASSWORD);
      await repos.transaction(async (tx) => {
        const u = await tx.users.findById(id);
        if (!u) throw fail('NOT_FOUND', '用户不存在');
        await tx.users.update(id, { password_hash: hash, password_salt: salt, failed_login_count: 0, locked_until: null });
        await tx.sessions.removeByUser(id);
      });
      return null;
    },
  };
  return svc;
}
