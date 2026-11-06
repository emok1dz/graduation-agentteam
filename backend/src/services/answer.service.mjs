// 在线答题：学生考试列表、开始/继续、保存、交卷（幂等）、sweepExam / sweepAll（超时兜底、缺考生成）
import { fail, validationError } from '../core/errors.mjs';
import { Validator, isPlainObject } from '../core/validator.mjs';
import { examStatus, computeDeadline, isExpired, studentExamStatus } from '../domain/exam-status.mjs';
import { validateResponseShape, normalizeResponse } from '../domain/scoring.mjs';
import { seededShuffle } from '../domain/shuffle.mjs';

const STUDENT_FILTERS = ['all', 'not_started', 'available', 'finished', 'missed'];

export function createAnswerService({ repos, config, svc }) {
  const GRACE = config.SUBMIT_GRACE_MS;

  const submitResult = (s, accepted) => ({
    submission_id: s.id, status: s.status, submit_type: s.submit_type, submitted_at: s.submitted_at, answers_accepted: accepted,
  });

  /** 事务内：以已保存答案交卷并自动阅卷 */
  async function finalizeTx(tx, sub, submit_type, submitted_at) {
    await tx.submissions.update(sub.id, { submit_type, submitted_at });
    return svc.grading.autoGradeTx(tx, sub.id);
  }

  /** 事务内：对单场考试执行超时兜底与缺考生成；返回是否有改动 */
  async function sweepExamTx(tx, examId, now) {
    const exam = await tx.exams.findById(examId);
    if (!exam || exam.cancelled_at) return;
    const t = now.getTime();
    for (const s of await tx.submissions.findMany((s) => s.exam_id === examId && s.status === 'in_progress')) {
      if (isExpired(s, t, GRACE)) await finalizeTx(tx, s, 'forced', s.deadline_at);
    }
    if (examStatus(exam, now) === 'ended' && !exam.absent_generated) {
      const classIds = new Set(await tx.exams.classIdsOf(examId));
      const has = new Set((await tx.submissions.listByExam(examId)).map((s) => s.student_id));
      const students = await tx.users.findMany((u) => u.role === 'student' && classIds.has(u.class_id) && !has.has(u.id));
      for (const u of students) {
        await tx.submissions.insert({
          exam_id: examId, student_id: u.id, class_id: u.class_id, status: 'graded', submit_type: 'absent',
          started_at: null, deadline_at: null, submitted_at: exam.end_time, last_saved_at: null,
          objective_score: 0, subjective_score: 0, total_score: 0,
        });
      }
      await tx.exams.update(examId, { absent_generated: true });
    }
  }

  function needsSweep(exam, now) {
    if (exam.cancelled_at) return false;
    if (examStatus(exam, now) === 'ended' && !exam.absent_generated) return true;
    const cutoff = new Date(now.getTime() - GRACE).toISOString();
    return repos.store.data.submissions.some((s) => s.exam_id === exam.id && s.status === 'in_progress' && s.deadline_at && s.deadline_at < cutoff);
  }

  async function sweepExam(examId, now) {
    const exam = await repos.exams.findById(examId);
    if (!exam || !needsSweep(exam, now)) return;
    await repos.transaction((tx) => sweepExamTx(tx, examId, now));
  }

  async function sweepAll(now) {
    const exams = (await repos.exams.findMany()).filter((e) => needsSweep(e, now));
    if (!exams.length) return 0;
    await repos.transaction(async (tx) => {
      for (const e of exams) await sweepExamTx(tx, e.id, now);
    });
    return exams.length;
  }

  async function studentExamView(exam, sub, now) {
    const paper = await repos.papers.findById(exam.paper_id);
    return {
      id: exam.id, title: exam.title, description: exam.description ?? '', start_time: exam.start_time, end_time: exam.end_time,
      duration_minutes: exam.duration_minutes, total_score: paper?.total_score ?? 0, question_count: paper?.question_count ?? 0,
      pass_score: exam.pass_score, student_status: studentExamStatus(exam, sub, now), submission_id: sub?.id ?? null,
      submission_status: sub?.status ?? null, results_published: !!exam.results_published,
    };
  }

  /** 学生可见考试：本班未取消考试 + 本人已有答卷的考试 */
  async function visibleExams(user) {
    const subs = await repos.submissions.listByStudent(user.id);
    const subBy = new Map(subs.map((s) => [s.exam_id, s]));
    const fromClass = user.class_id ? new Set((await repos.exams.listByClass(user.class_id)).map((e) => e.id)) : new Set();
    const exams = await repos.exams.findMany((e) => !e.cancelled_at && (fromClass.has(e.id) || subBy.has(e.id)));
    return { exams, subBy, fromClass };
  }

  /** 学生对考试的访问校验：取消 → 40400；非本班且无答卷 → 40301 */
  async function studentAccess(user, examId, repo = repos) {
    const exam = await repo.exams.findById(examId);
    if (!exam || exam.cancelled_at) throw fail('NOT_FOUND', '考试不存在');
    const sub = await repo.submissions.findByExamStudent(examId, user.id);
    if (!sub) {
      const classIds = await repo.exams.classIdsOf(examId);
      if (!user.class_id || !classIds.includes(user.class_id)) throw fail('FORBIDDEN_OWNER', '不是本班考试');
    }
    return { exam, sub };
  }

  async function answerSheet(exam, sub, now) {
    const paper = await repos.papers.findById(exam.paper_id);
    const pqs = await repos.papers.listQuestions(exam.paper_id);
    const answers = new Map((await repos.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
    return {
      submission_id: sub.id,
      exam: {
        id: exam.id, title: exam.title, description: exam.description ?? '', total_score: paper?.total_score ?? 0,
        duration_minutes: exam.duration_minutes, start_time: exam.start_time, end_time: exam.end_time,
      },
      started_at: sub.started_at,
      deadline_at: sub.deadline_at,
      server_time: now.toISOString(),
      last_saved_at: sub.last_saved_at ?? null,
      questions: pqs.map((pq) => ({
        id: pq.id, seq: pq.seq, type: pq.type, stem: pq.stem,
        options: exam.shuffle_options && pq.options?.length ? seededShuffle(pq.options, sub.id * 1000 + pq.id) : pq.options || [],
        score: pq.score, blank_count: pq.blank_count,
      })),
      answers: pqs.map((pq) => ({ paper_question_id: pq.id, response: answers.get(pq.id)?.response ?? null })),
    };
  }

  /** 校验 answers 数组（属于试卷 + 形状），返回规范化列表 */
  function parseAnswers(raw, pqMap, { required, field = 'answers' }) {
    if (raw === undefined || raw === null) {
      if (required) throw validationError([{ field, message: '答案列表不能为空' }]);
      return [];
    }
    if (!Array.isArray(raw)) throw validationError([{ field, message: '答案列表必须为数组' }]);
    if (required && raw.length < 1) throw validationError([{ field, message: '答案列表至少 1 项' }]);
    if (raw.length > 200) throw validationError([{ field, message: '答案列表最多 200 项' }]);
    const errs = [];
    const out = new Map();
    raw.forEach((it, i) => {
      if (!isPlainObject(it)) return errs.push({ field: `${field}[${i}]`, message: '答案项格式不正确' });
      const pq = pqMap.get(it.paper_question_id);
      if (!pq) return errs.push({ field: `${field}[${i}].paper_question_id`, message: '题目不属于该试卷' });
      const msg = validateResponseShape(pq, it.response === undefined ? undefined : it.response);
      if (msg) return errs.push({ field: `${field}[${i}].response`, message: msg });
      out.set(pq.id, { paper_question_id: pq.id, response: normalizeResponse(pq, it.response) });
    });
    if (errs.length) throw validationError(errs);
    return [...out.values()];
  }

  async function ownSubmissionTx(tx, user, id) {
    const sub = await tx.submissions.findById(id);
    if (!sub) throw fail('NOT_FOUND', '答卷不存在');
    if (sub.student_id !== user.id) throw fail('FORBIDDEN_OWNER');
    return sub;
  }

  return {
    sweepExam,
    sweepExamTx,
    sweepAll,
    submitResult,

    async listStudentExams(user, query, now) {
      const vd = new Validator(query, { query: true });
      const status = vd.enum('status', STUDENT_FILTERS, { def: 'all', label: '状态' });
      vd.check();
      let { exams } = await visibleExams(user);
      for (const e of exams) await sweepExam(e.id, now);
      const v2 = await visibleExams(user);
      exams = v2.exams.sort((a, b) => (b.start_time < a.start_time ? -1 : b.start_time > a.start_time ? 1 : b.id - a.id));
      const items = [];
      for (const e of exams) {
        const item = await studentExamView(e, v2.subBy.get(e.id) || null, now);
        const s = item.student_status;
        if (status === 'all' || s === status || (status === 'available' && s === 'in_progress')) items.push(item);
      }
      return { server_time: now.toISOString(), items };
    },

    async getStudentExam(user, examId, now) {
      await studentAccess(user, examId);
      await sweepExam(examId, now);
      const { exam, sub } = await studentAccess(user, examId);
      return { ...(await studentExamView(exam, sub, now)), server_time: now.toISOString() };
    },

    async start(user, examId, now) {
      await studentAccess(user, examId);
      await sweepExam(examId, now);
      const r = await repos.transaction(async (tx) => {
        const { exam, sub } = await studentAccess(user, examId, tx);
        if (sub) {
          // 缺考记录（考试结束后生成）不属于“已交卷”，按 §8.1 视为不在考试时间内
          if (sub.submit_type === 'absent') return { err: fail('EXAM_NOT_AVAILABLE') };
          if (sub.status !== 'in_progress') return { err: fail('ALREADY_SUBMITTED', undefined, submitResult(sub, false)) };
          if (isExpired(sub, now, GRACE)) {
            const done = await finalizeTx(tx, sub, 'forced', sub.deadline_at);
            return { err: fail('ALREADY_SUBMITTED', undefined, submitResult(done, false)) };
          }
          return { exam, sub };
        }
        if (examStatus(exam, now) !== 'ongoing') return { err: fail('EXAM_NOT_AVAILABLE') };
        const nowIso = now.toISOString();
        const created = await tx.submissions.insert({
          exam_id: exam.id, student_id: user.id, class_id: user.class_id, status: 'in_progress', submit_type: null,
          started_at: nowIso, deadline_at: computeDeadline(now.getTime(), exam), submitted_at: null, last_saved_at: null,
          objective_score: null, subjective_score: null, total_score: null,
        });
        for (const pq of await tx.papers.listQuestions(exam.paper_id)) {
          await tx.submissions.insertAnswer({
            submission_id: created.id, paper_question_id: pq.id, response: null, score: null, is_correct: null,
            comment: null, graded_by: null, graded_at: null,
          });
        }
        return { exam, sub: created };
      });
      if (r.err) throw r.err;
      return answerSheet(r.exam, r.sub, now);
    },

    async save(user, id, body, now) {
      const r = await repos.transaction(async (tx) => {
        const sub = await ownSubmissionTx(tx, user, id);
        if (sub.status !== 'in_progress') return { err: fail('ALREADY_SUBMITTED', undefined, submitResult(sub, false)) };
        if (isExpired(sub, now, GRACE)) {
          await finalizeTx(tx, sub, 'forced', sub.deadline_at);
          return { err: fail('DEADLINE_PASSED') };
        }
        const exam = await tx.exams.findById(sub.exam_id);
        const pqMap = new Map((await tx.papers.listQuestions(exam.paper_id)).map((pq) => [pq.id, pq]));
        const items = parseAnswers(isPlainObject(body) ? body.answers : undefined, pqMap, { required: true });
        await tx.submissions.upsertAnswers(sub.id, items);
        const nowIso = now.toISOString();
        const updated = await tx.submissions.update(sub.id, { last_saved_at: nowIso });
        return { data: { saved_at: nowIso, server_time: nowIso, deadline_at: updated.deadline_at } };
      });
      if (r.err) throw r.err;
      return r.data;
    },

    async submit(user, id, body, now) {
      const b = isPlainObject(body) ? body : {};
      if (b.auto !== undefined && b.auto !== null && typeof b.auto !== 'boolean') {
        throw validationError([{ field: 'auto', message: 'auto 必须为布尔值' }]);
      }
      const r = await repos.transaction(async (tx) => {
        const sub = await ownSubmissionTx(tx, user, id);
        if (sub.status !== 'in_progress') return { err: fail('ALREADY_SUBMITTED', undefined, submitResult(sub, false)) };
        if (isExpired(sub, now, GRACE)) {
          const done = await finalizeTx(tx, sub, 'forced', sub.deadline_at);
          return { data: submitResult(done, false) };
        }
        const exam = await tx.exams.findById(sub.exam_id);
        const pqMap = new Map((await tx.papers.listQuestions(exam.paper_id)).map((pq) => [pq.id, pq]));
        const items = parseAnswers(b.answers, pqMap, { required: false });
        if (items.length) await tx.submissions.upsertAnswers(sub.id, items);
        const nowIso = now.toISOString();
        if (items.length) await tx.submissions.update(sub.id, { last_saved_at: nowIso });
        const done = await finalizeTx(tx, sub, b.auto ? 'auto' : 'manual', nowIso);
        return { data: submitResult(done, true) };
      });
      if (r.err) throw r.err;
      return r.data;
    },
  };
}
