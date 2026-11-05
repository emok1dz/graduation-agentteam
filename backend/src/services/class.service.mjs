// 班级：CRUD、成员管理、任课关系；assertTeachesClass
import { fail, validationError } from '../core/errors.mjs';
import { Validator } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';

const brief = (u) => ({ id: u.id, username: u.username, name: u.name });

export function createClassService({ repos }) {
  async function toClassInfo(c) {
    const teacherIds = await repos.classes.listTeacherIds(c.id);
    const teachers = (await repos.users.findMany((u) => teacherIds.includes(u.id)))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map(brief);
    const student_count = await repos.users.count((u) => u.role === 'student' && u.class_id === c.id);
    return {
      id: c.id, name: c.name, grade: c.grade ?? '', major: c.major ?? '', remark: c.remark ?? '',
      student_count, teachers, created_at: c.created_at, updated_at: c.updated_at,
    };
  }
  async function members(c) {
    const info = await toClassInfo(c);
    const students = (await repos.users.findMany((u) => u.role === 'student' && u.class_id === c.id))
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u) => ({ ...brief(u), status: u.status }));
    return { class: info, students, teachers: info.teachers };
  }
  function parseInput(body) {
    const vd = new Validator(body);
    const out = {
      name: vd.str('name', { required: true, min: 1, max: 30, label: '班级名称' }),
      grade: vd.str('grade', { max: 10, def: '', label: '年级' }) ?? '',
      major: vd.str('major', { max: 30, def: '', label: '专业' }) ?? '',
      remark: vd.str('remark', { max: 200, def: '', label: '备注' }) ?? '',
    };
    vd.check();
    return out;
  }
  async function getOr404(id) {
    const c = await repos.classes.findById(id);
    if (!c) throw fail('NOT_FOUND', '班级不存在');
    return c;
  }

  const svc = {
    toClassInfo,
    async assertTeachesClass(teacherId, classId) {
      if (!(await repos.classes.teaches(teacherId, classId))) throw fail('FORBIDDEN_OWNER', '只能操作本人任课班级');
    },
    async list(user, query) {
      const vd = new Validator(query, { query: true });
      const keyword = vd.str('keyword', { max: 50 });
      vd.check();
      const pg = parsePage(query);
      let ids = null;
      if (user.role === 'teacher') ids = new Set(await repos.classes.listClassIdsByTeacher(user.id));
      if (user.role === 'student') ids = new Set(user.class_id ? [user.class_id] : []);
      const kw = keyword ? keyword.toLowerCase() : null;
      const list = (await repos.classes.findMany(
        (c) => (!ids || ids.has(c.id)) && (!kw || c.name.toLowerCase().includes(kw) || (c.major || '').toLowerCase().includes(kw)),
      )).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      const page = paginate(list, pg);
      page.items = await Promise.all(page.items.map(toClassInfo));
      return page;
    },
    async create(body) {
      const input = parseInput(body);
      const c = await repos.transaction(async (tx) => {
        if (await tx.classes.findByName(input.name)) throw fail('DUPLICATE', '班级名称已存在');
        return tx.classes.insert(input);
      });
      return toClassInfo(c);
    },
    async get(user, id) {
      const c = await getOr404(id);
      if (user.role === 'teacher' && !(await repos.classes.teaches(user.id, id))) throw fail('FORBIDDEN_OWNER');
      if (user.role === 'student' && user.class_id !== id) throw fail('FORBIDDEN_OWNER');
      return toClassInfo(c);
    },
    async update(id, body) {
      const input = parseInput(body);
      const c = await repos.transaction(async (tx) => {
        if (!(await tx.classes.findById(id))) throw fail('NOT_FOUND', '班级不存在');
        const dup = await tx.classes.findByName(input.name);
        if (dup && dup.id !== id) throw fail('DUPLICATE', '班级名称已存在');
        return tx.classes.update(id, input);
      });
      return toClassInfo(c);
    },
    async remove(id) {
      await repos.transaction(async (tx) => {
        if (!(await tx.classes.findById(id))) throw fail('NOT_FOUND', '班级不存在');
        if ((await tx.users.count((u) => u.role === 'student' && u.class_id === id)) > 0) throw fail('RESOURCE_IN_USE', '班级下仍有学生，不能删除');
        if ((await tx.exams.countByClass(id)) > 0) throw fail('RESOURCE_IN_USE', '班级存在关联考试，不能删除');
        await tx.classes.removeTeacherLinks({ class_id: id });
        await tx.classes.remove(id);
      });
      return null;
    },
    async members(user, id) {
      const c = await getOr404(id);
      if (user.role === 'teacher' && !(await repos.classes.teaches(user.id, id))) throw fail('FORBIDDEN_OWNER');
      return members(c);
    },
    async addStudents(id, body) {
      const vd = new Validator(body);
      const ids = vd.intArray('student_ids', { required: true, min: 1, max: 500, label: '学生' });
      const force = vd.bool('force_move', { def: false });
      vd.check();
      await repos.transaction(async (tx) => {
        if (!(await tx.classes.findById(id))) throw fail('NOT_FOUND', '班级不存在');
        const students = await tx.users.findMany((u) => ids.includes(u.id));
        const map = new Map(students.map((u) => [u.id, u]));
        const errs = [];
        body.student_ids.forEach((sid, i) => {
          const u = map.get(sid);
          if (!u || u.role !== 'student') errs.push({ field: `student_ids[${i}]`, message: `ID ${sid} 不是学生账号` });
        });
        if (errs.length) throw validationError(errs);
        const others = students.filter((u) => u.class_id != null && u.class_id !== id);
        if (others.length && !force) {
          const cls = new Map((await tx.classes.findMany()).map((c) => [c.id, c.name]));
          throw fail('STUDENT_IN_OTHER_CLASS', undefined, {
            conflicts: others.map((u) => ({
              student_id: u.id, username: u.username, name: u.name, current_class_id: u.class_id, current_class_name: cls.get(u.class_id) ?? '',
            })),
          });
        }
        for (const u of students) if (u.class_id !== id) await tx.users.update(u.id, { class_id: id });
      });
      return members(await getOr404(id));
    },
    async removeStudents(id, body) {
      const vd = new Validator(body);
      const ids = vd.intArray('student_ids', { required: true, min: 1, max: 500, label: '学生' });
      vd.check();
      await repos.transaction(async (tx) => {
        if (!(await tx.classes.findById(id))) throw fail('NOT_FOUND', '班级不存在');
        await tx.users.updateWhere((u) => ids.includes(u.id) && u.role === 'student' && u.class_id === id, { class_id: null });
      });
      return members(await getOr404(id));
    },
    async setTeachers(id, body) {
      const vd = new Validator(body);
      const ids = vd.intArray('teacher_ids', { required: true, min: 0, max: 50, label: '教师' });
      vd.check();
      await repos.transaction(async (tx) => {
        if (!(await tx.classes.findById(id))) throw fail('NOT_FOUND', '班级不存在');
        const users = new Map((await tx.users.findMany((u) => ids.includes(u.id))).map((u) => [u.id, u]));
        const errs = [];
        body.teacher_ids.forEach((tid, i) => {
          const u = users.get(tid);
          if (!u || u.role !== 'teacher') errs.push({ field: `teacher_ids[${i}]`, message: `ID ${tid} 不是教师账号` });
        });
        if (errs.length) throw validationError(errs);
        await tx.classes.setTeachers(id, ids);
      });
      return members(await getOr404(id));
    },
  };
  return svc;
}
