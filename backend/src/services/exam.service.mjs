// 考试：发布/修改/取消、列表 counts、监控；toExamView(exam, now)
import { fail, validationError } from '../core/errors.mjs';
import { Validator } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';
import { examStatus, computeDeadline } from '../domain/exam-status.mjs';
import { round1 } from '../domain/scoring.mjs';

const EXAM_STATUSES = ['not_started', 'ongoing', 'ended', 'cancelled'];
const brief = (u) => (u ? { id: u.id, username: u.username, name: u.name } : null);

export function createExamService({ repos, svc }) {
  /** 参考班级学生 + 已有答卷学生（按答卷 class_id 归班），可按 classIds 过滤 */
  async function participants(exam, filterClassIds = null) {
    const examClassIds = await repos.exams.classIdsOf(exam.id);
    const selected = new Set(filterClassIds || examClassIds);
    const subs = await repos.submissions.listByExam(exam.id);
    const subBy = new Map(subs.map((s) => [s.student_id, s]));
    const clsSet = new Set(examClassIds);
    const students = await repos.users.findMany((u) => u.role === 'student' && (clsSet.has(u.class_id) || subBy.has(u.id)));
    const classes = new Map((await repos.classes.findMany()).map((c) => [c.id, c]));
    const rows = [];
    for (const u of students) {
      const sub = subBy.get(u.id) || null;
      const cid = sub ? sub.class_id : u.class_id;
      if (!selected.has(cid)) continue;
      rows.push({ user: u, sub, class_id: cid, class_name: classes.get(cid)?.name ?? '' });
    }
    return rows;
  }

  async function counts(exam) {
    const classIds = new Set(await repos.exams.classIdsOf(exam.id));
    const expected = await repos.users.count((u) => u.role === 'student' && classIds.has(u.class_id));
    const c = { expected, started: 0, submitted: 0, pending_review: 0, graded: 0, absent: 0 };
    for (const s of await repos.submissions.listByExam(exam.id)) {
      if (s.submit_type === 'absent') c.absent++;
      else if (s.status === 'in_progress') c.started++;
      else {
        c.submitted++;
        if (s.status === 'pending_review') c.pending_review++;
        else c.graded++;
      }
    }
    return c;
  }

  async function toExamView(exam, now) {
    const paper = await repos.papers.findById(exam.paper_id);
    const classIds = await repos.exams.classIdsOf(exam.id);
    const classes = (await repos.classes.findMany((c) => classIds.includes(c.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((c) => ({ id: c.id, name: c.name }));
    const teacher = await repos.users.findById(exam.teacher_id);
    return {
      id: exam.id, title: exam.title, description: exam.description ?? '', paper_id: exam.paper_id,
      paper_title: paper?.title ?? '', total_score: paper?.total_score ?? 0, question_count: paper?.question_count ?? 0,
      start_time: exam.start_time, end_time: exam.end_time, duration_minutes: exam.duration_minutes,
      pass_score: exam.pass_score, shuffle_options: !!exam.shuffle_options, status: examStatus(exam, now),
      classes, teacher: brief(teacher) || { id: exam.teacher_id, username: '', name: '' },
      results_published: !!exam.results_published, results_published_at: exam.results_published_at ?? null,
      allow_review: exam.allow_review !== false, cancelled_at: exam.cancelled_at ?? null,
      counts: await counts(exam), created_at: exam.created_at, updated_at: exam.updated_at,
    };
  }

  async function getOr404(id, repo = repos) {
    const e = await repo.exams.findById(id);
    if (!e) throw fail('NOT_FOUND', '考试不存在');
    return e;
  }
  /** teacher 仅本人；admin 只读放行（allowAdmin） */
  async function accessible(user, id, { allowAdmin = true, repo = repos } = {}) {
    const e = await getOr404(id, repo);
    if (user.role === 'admin' && allowAdmin) return e;
    if (user.role !== 'teacher' || e.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER');
    return e;
  }

  /** 校验 ExamInput 字段；partial=true 时只校验出现的字段 */
  function parseFields(body, partial) {
    const vd = new Validator(body);
    const req = !partial;
    const o = {};
    const has = (f) => !partial || (body && body[f] !== undefined);
    if (has('title')) o.title = vd.str('title', { required: true, min: 1, max: 100, label: '考试名称' });
    if (has('description')) o.description = vd.str('description', { max: 1000, def: '', label: '考试说明' }) ?? '';
    if (has('paper_id')) o.paper_id = vd.int('paper_id', { required: true, min: 1, label: '试卷' });
    if (has('start_time')) o.start_time = vd.iso('start_time', { required: true, label: '开始时间' });
    if (has('end_time')) o.end_time = vd.iso('end_time', { required: true, label: '结束时间' });
    if (has('duration_minutes')) o.duration_minutes = vd.int('duration_minutes', { required: true, min: 1, max: 1440, label: '考试时长' });
    if (has('class_ids')) o.class_ids = vd.intArray('class_ids', { required: true, min: 1, label: '参考班级' });
    if (has('pass_score')) {
      const ps = body?.pass_score;
      if (ps === undefined || ps === null) o.pass_score = null;
      else o.pass_score = vd.score('pass_score', { min: 0, max: 100000, label: '及格线' });
    }
    if (has('shuffle_options')) o.shuffle_options = vd.bool('shuffle_options', { def: false, label: '选项乱序' }) ?? false;
    void req;
    return { vd, o };
  }

  /** 事务内业务校验并返回规范化后的完整字段 */
  async function checkFullTx(tx, user, f, now) {
    const errs = [];
    const t = now.getTime();
    const st = Date.parse(f.start_time);
    const et = Date.parse(f.end_time);
    if (st <= t) errs.push({ field: 'start_time', message: '开始时间必须晚于当前时间' });
    if (et <= st) errs.push({ field: 'end_time', message: '结束时间必须晚于开始时间' });
    else if (f.duration_minutes > (et - st) / 60000) errs.push({ field: 'duration_minutes', message: '考试时长不能超过时间窗口长度' });
    const paper = await tx.papers.findById(f.paper_id);
    if (paper && paper.teacher_id === user.id && f.pass_score !== null && f.pass_score > paper.total_score) {
      errs.push({ field: 'pass_score', message: `及格线必须介于 0 与试卷总分 ${paper.total_score} 之间` });
    }
    if (errs.length) throw validationError(errs);
    if (!paper) throw fail('NOT_FOUND', '试卷不存在');
    if (paper.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER', '只能使用本人试卷');
    for (const cid of f.class_ids) {
      if (!(await tx.classes.findById(cid))) throw fail('NOT_FOUND', `班级 ${cid} 不存在`);
      if (!(await tx.classes.teaches(user.id, cid))) throw fail('FORBIDDEN_OWNER', '只能向本人任课班级发布考试');
    }
    return { ...f, pass_score: f.pass_score === null ? round1(paper.total_score * 0.6) : f.pass_score };
  }

  const self = {
    toExamView,
    participants,
    accessible,
    getOr404,
    async list(user, query, now) {
      const vd = new Validator(query, { query: true });
      const status = vd.enum('status', EXAM_STATUSES, { label: '状态' });
      const keyword = vd.str('keyword', { max: 50 });
      vd.check();
      const pg = parsePage(query);
      await svc.answer.sweepAll(now);
      const kw = keyword ? keyword.toLowerCase() : null;
      const all = user.role === 'admin' ? await repos.exams.listAll() : await repos.exams.listByTeacher(user.id);
      const list = all.filter((e) => (!status || examStatus(e, now) === status) && (!kw || e.title.toLowerCase().includes(kw)));
      const page = paginate(list, pg);
      page.items = await Promise.all(page.items.map((e) => toExamView(e, now)));
      return page;
    },
    async create(user, body, now) {
      const { vd, o } = parseFields(body, false);
      vd.check();
      const exam = await repos.transaction(async (tx) => {
        const f = await checkFullTx(tx, user, o, now);
        const e = await tx.exams.insert({
          teacher_id: user.id, paper_id: f.paper_id, title: f.title, description: f.description,
          start_time: f.start_time, end_time: f.end_time, duration_minutes: f.duration_minutes, pass_score: f.pass_score,
          shuffle_options: !!f.shuffle_options, cancelled_at: null, results_published: false, results_published_at: null,
          allow_review: true, absent_generated: false,
        });
        await tx.exams.setClasses(e.id, f.class_ids);
        return e;
      });
      return toExamView(exam, now);
    },
    async get(user, id, now) {
      return toExamView(await accessible(user, id), now);
    },
    async update(user, id, body, now) {
      const { vd, o } = parseFields(body, true);
      vd.check();
      const exam = await repos.transaction(async (tx) => {
        const e = await accessible(user, id, { allowAdmin: false, repo: tx });
        const status = examStatus(e, now);
        if (status === 'not_started') {
          const cur = {
            title: e.title, description: e.description, paper_id: e.paper_id, start_time: e.start_time, end_time: e.end_time,
            duration_minutes: e.duration_minutes, class_ids: await tx.exams.classIdsOf(id), pass_score: e.pass_score,
            shuffle_options: e.shuffle_options,
          };
          // 修改试卷且未给及格线时按新试卷总分重新计算缺省值
          if (o.paper_id !== undefined && o.paper_id !== e.paper_id && o.pass_score === undefined) o.pass_score = null;
          const merged = { ...cur, ...o };
          const f = await checkFullTx(tx, user, merged, now);
          const { class_ids, ...fields } = f;
          await tx.exams.setClasses(id, class_ids);
          return tx.exams.update(id, { ...fields, shuffle_options: !!fields.shuffle_options });
        }
        if (status === 'ongoing') {
          const keys = Object.keys(o);
          if (keys.some((k) => k !== 'end_time') || keys.length === 0) throw fail('STATE_CONFLICT', '进行中的考试仅可延长结束时间');
          if (Date.parse(o.end_time) <= Date.parse(e.end_time)) throw validationError([{ field: 'end_time', message: '新的结束时间必须晚于原结束时间' }]);
          const updated = await tx.exams.update(id, { end_time: o.end_time });
          for (const s of await tx.submissions.findMany((s) => s.exam_id === id && s.status === 'in_progress')) {
            await tx.submissions.update(s.id, { deadline_at: computeDeadline(Date.parse(s.started_at), updated) });
          }
          return updated;
        }
        throw fail('STATE_CONFLICT', status === 'ended' ? '考试已结束，不能修改' : '考试已取消，不能修改');
      });
      return toExamView(exam, now);
    },
    async cancel(user, id, now) {
      const exam = await repos.transaction(async (tx) => {
        const e = await accessible(user, id, { allowAdmin: false, repo: tx });
        if (examStatus(e, now) !== 'not_started') throw fail('STATE_CONFLICT', '仅未开始的考试可以取消');
        return tx.exams.update(id, { cancelled_at: now.toISOString() });
      });
      return toExamView(exam, now);
    },
    async monitor(user, id, now) {
      await accessible(user, id, { allowAdmin: false });
      await svc.answer.sweepExam(id, now);
      const exam = await getOr404(id);
      const rows = await participants(exam);
      const items = rows
        .map(({ user: u, sub, class_id, class_name }) => ({
          student_id: u.id, username: u.username, name: u.name, class_id, class_name,
          state: !sub ? 'not_started' : sub.submit_type === 'absent' ? 'absent' : sub.status === 'in_progress' ? 'in_progress' : 'submitted',
          submission_id: sub?.id ?? null, started_at: sub?.started_at ?? null, submitted_at: sub?.submitted_at ?? null,
          submit_type: sub?.submit_type ?? null,
        }))
        .sort((a, b) => a.class_name.localeCompare(b.class_name, 'zh-CN') || a.username.localeCompare(b.username));
      return { exam_id: id, status: examStatus(exam, now), server_time: now.toISOString(), items };
    },
  };
  return self;
}
