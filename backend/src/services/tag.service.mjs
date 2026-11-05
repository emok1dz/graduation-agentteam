// 知识点标签：CRUD、ensureTags 自动建标签
import { fail } from '../core/errors.mjs';
import { Validator } from '../core/validator.mjs';

export function createTagService({ repos }) {
  const view = (t) => ({ id: t.id, name: t.name, question_count: repos.tags.questionCount(t.id), created_at: t.created_at });
  const parse = (body) => {
    const vd = new Validator(body);
    const name = vd.str('name', { required: true, min: 1, max: 20, label: '标签名称' });
    vd.check();
    return name;
  };
  async function ownOr404(user, id) {
    const t = await repos.tags.findById(id);
    if (!t) throw fail('NOT_FOUND', '标签不存在');
    if (t.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER');
    return t;
  }
  return {
    async list(user) {
      return (await repos.tags.listByTeacher(user.id)).map(view);
    },
    async create(user, body) {
      const name = parse(body);
      const t = await repos.transaction(async (tx) => {
        if (await tx.tags.findByName(user.id, name)) throw fail('DUPLICATE', '标签已存在');
        return tx.tags.insert({ teacher_id: user.id, name });
      });
      return view(t);
    },
    async rename(user, id, body) {
      const name = parse(body);
      const t = await repos.transaction(async (tx) => {
        await ownOr404(user, id);
        const dup = await tx.tags.findByName(user.id, name);
        if (dup && dup.id !== id) throw fail('DUPLICATE', '标签已存在');
        return tx.tags.update(id, { name });
      });
      return view(t);
    },
    async remove(user, id) {
      await repos.transaction(async (tx) => {
        await ownOr404(user, id);
        await tx.questions.removeTagLinks({ tag_id: id });
        await tx.tags.remove(id);
      });
      return null;
    },
    /** 事务内：按名称查找或创建标签，返回 tag id 数组 */
    async ensureTagsTx(tx, teacherId, names) {
      const ids = [];
      for (const name of names) {
        let t = await tx.tags.findByName(teacherId, name);
        if (!t) t = await tx.tags.insert({ teacher_id: teacherId, name });
        ids.push(t.id);
      }
      return ids;
    },
  };
}
