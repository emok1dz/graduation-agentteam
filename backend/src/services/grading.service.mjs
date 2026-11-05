// 阅卷：autoGrade、简答评分、批改总览、发布/撤回成绩、学生成绩视图、答卷详情
import { fail, validationError } from '../core/errors.mjs';
import { Validator, isPlainObject, isScore1 } from '../core/validator.mjs';
import { parsePage, paginate } from '../core/pagination.mjs';
import { examStatus } from '../domain/exam-status.mjs';
import { scoreAnswer, round1 } from '../domain/scoring.mjs';

const brief = (u) => ({ id: u.id, username: u.username, name: u.name });

export function createGradingService({ repos, svc }) {
  /** 事务内：客观题判分并设置状态；返回更新后的答卷 */
  async function autoGradeTx(tx, subId) {
    const sub = await tx.submissions.findById(subId);
    const exam = await tx.exams.findById(sub.exam_id);
    const pqs = await tx.papers.listQuestions(exam.paper_id);
    const answers = new Map((await tx.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
    let objective = 0;
    let hasEssay = false;
    for (const pq of pqs) {
      const a = answers.get(pq.id);
      if (pq.type === 'essay') {
        hasEssay = true;
        if (!a) await tx.submissions.insertAnswer(blankAnswer(sub.id, pq.id));
        continue;
      }
      const { score, is_correct } = scoreAnswer(pq, a ? a.response : null);
      objective += score;
      if (a) await tx.submissions.updateAnswer(a.id, { score, is_correct });
      else await tx.submissions.insertAnswer({ ...blankAnswer(sub.id, pq.id), score, is_correct });
    }
    objective = round1(objective);
    const patch = hasEssay
      ? { status: 'pending_review', objective_score: objective, subjective_score: null, total_score: null }
      : { status: 'graded', objective_score: objective, subjective_score: 0, total_score: objective };
    return tx.submissions.update(sub.id, patch);
  }
  const blankAnswer = (submission_id, paper_question_id) => ({
    submission_id, paper_question_id, response: null, score: null, is_correct: null, comment: null, graded_by: null, graded_at: null,
  });

  function essayProgress(pqs, answerMap) {
    const essays = pqs.filter((pq) => pq.type === 'essay');
    const graded = essays.filter((pq) => answerMap.get(pq.id)?.score != null).length;
    return { essay_graded: graded, essay_total: essays.length };
  }

  function submissionScore(sub, exam, { hideScores = false } = {}) {
    const graded = sub.status === 'graded';
    return {
      id: sub.id, status: sub.status, submit_type: sub.submit_type ?? null, started_at: sub.started_at ?? null,
      deadline_at: sub.deadline_at ?? null, submitted_at: sub.submitted_at ?? null,
      objective_score: hideScores ? null : sub.objective_score ?? null,
      subjective_score: hideScores ? null : sub.subjective_score ?? null,
      total_score: hideScores ? null : sub.total_score ?? null,
      passed: hideScores || !graded || sub.total_score == null ? null : sub.total_score >= exam.pass_score - 1e-9,
    };
  }

  function reviewQuestions(pqs, answerMap, sub) {
    return pqs.map((pq) => {
      const a = answerMap.get(pq.id);
      const absent = sub.submit_type === 'absent';
      return {
        id: pq.id, seq: pq.seq, type: pq.type, stem: pq.stem, options: pq.options || [], score: pq.score, blank_count: pq.blank_count,
        response: a ? a.response : null, correct_answer: pq.answer ?? null, analysis: pq.analysis ?? '',
        got_score: a ? a.score ?? null : absent ? 0 : null,
        is_correct: pq.type === 'essay' ? null : a ? a.is_correct ?? null : absent ? false : null,
        comment: a ? a.comment ?? null : null,
      };
    });
  }

  async function ownExam(user, examId, repo = repos) {
    return svc.exam.accessible(user, examId, { allowAdmin: false, repo });
  }

  return {
    autoGradeTx,
    submissionScore,

    async grade(user, subId, body, now) {
      const raw = isPlainObject(body) ? body.grades : undefined;
      if (!Array.isArray(raw) || raw.length < 1) throw validationError([{ field: 'grades', message: '评分列表至少 1 项' }]);
      return repos.transaction(async (tx) => {
        const sub = await tx.submissions.findById(subId);
        if (!sub) throw fail('NOT_FOUND', '答卷不存在');
        const exam = await tx.exams.findById(sub.exam_id);
        if (exam.teacher_id !== user.id) throw fail('FORBIDDEN_OWNER');
        if (sub.status !== 'pending_review' && sub.status !== 'graded') throw fail('STATE_CONFLICT', '答卷尚未交卷，不能批改');
        if (exam.results_published) throw fail('RESULTS_PUBLISHED');
        const pqs = await tx.papers.listQuestions(exam.paper_id);
        const pqMap = new Map(pqs.map((pq) => [pq.id, pq]));
        const errs = [];
        const items = [];
        raw.forEach((g, i) => {
          if (!isPlainObject(g)) return errs.push({ field: `grades[${i}]`, message: '评分项格式不正确' });
          const pq = pqMap.get(g.paper_question_id);
          if (!pq || pq.type !== 'essay') return errs.push({ field: `grades[${i}].paper_question_id`, message: '只能对该试卷的简答题评分' });
          if (sub.submit_type === 'absent') return errs.push({ field: `grades[${i}].paper_question_id`, message: '缺考答卷无需批改' });
          if (typeof g.score !== 'number' || !isScore1(g.score) || g.score < 0 || g.score > pq.score + 1e-9)
            return errs.push({ field: `grades[${i}].score`, message: `得分须在 0~${pq.score} 之间且最多 1 位小数` });
          if (g.comment !== undefined && g.comment !== null && (typeof g.comment !== 'string' || [...g.comment].length > 500))
            return errs.push({ field: `grades[${i}].comment`, message: '评语须为不超过 500 字的字符串' });
          items.push({ pq, score: round1(g.score), comment: g.comment ?? null, hasComment: g.comment !== undefined });
        });
        if (errs.length) throw validationError(errs);
        const nowIso = now.toISOString();
        const answers = new Map((await tx.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
        for (const it of items) {
          const patch = { score: it.score, is_correct: null, graded_by: user.id, graded_at: nowIso };
          if (it.hasComment) patch.comment = it.comment;
          const a = answers.get(it.pq.id);
          if (a) await tx.submissions.updateAnswer(a.id, patch);
          else await tx.submissions.insertAnswer({ ...blankAnswer(sub.id, it.pq.id), ...patch });
        }
        const after = new Map((await tx.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
        const essays = pqs.filter((pq) => pq.type === 'essay');
        const gradedEss = essays.filter((pq) => after.get(pq.id)?.score != null);
        const subjective = round1(gradedEss.reduce((s, pq) => s + after.get(pq.id).score, 0));
        const all = gradedEss.length === essays.length;
        const updated = await tx.submissions.update(sub.id, all
          ? { status: 'graded', subjective_score: subjective, total_score: round1((sub.objective_score || 0) + subjective) }
          : { status: 'pending_review', subjective_score: subjective, total_score: null });
        return {
          submission_id: sub.id, status: updated.status, objective_score: updated.objective_score ?? 0,
          subjective_score: updated.subjective_score, total_score: updated.total_score,
          essay_graded: gradedEss.length, essay_total: essays.length,
        };
      });
    },

    async overview(user, examId, now) {
      await ownExam(user, examId);
      await svc.answer.sweepExam(examId, now);
      const exam = await repos.exams.findById(examId);
      const pqs = await repos.papers.listQuestions(exam.paper_id);
      const subs = (await repos.submissions.listByExam(examId)).filter((s) => s.status !== 'in_progress' && s.submit_type !== 'absent');
      subs.sort((a, b) => (a.status === 'pending_review' ? 0 : 1) - (b.status === 'pending_review' ? 0 : 1) || (a.submitted_at || '').localeCompare(b.submitted_at || '') || a.id - b.id);
      const ansBySub = new Map();
      for (const a of await repos.submissions.answersOfMany(subs.map((s) => s.id))) {
        if (!ansBySub.has(a.submission_id)) ansBySub.set(a.submission_id, new Map());
        ansBySub.get(a.submission_id).set(a.paper_question_id, a);
      }
      const users = new Map((await repos.users.findMany((u) => u.role === 'student')).map((u) => [u.id, u]));
      const classes = new Map((await repos.classes.findMany()).map((c) => [c.id, c.name]));
      const essay_questions = pqs.filter((pq) => pq.type === 'essay').map((pq) => ({
        paper_question_id: pq.id, seq: pq.seq, stem: pq.stem, score: pq.score,
        graded_count: subs.filter((s) => ansBySub.get(s.id)?.get(pq.id)?.score != null).length,
        total_count: subs.length,
      }));
      const graded = subs.filter((s) => s.status === 'graded').length;
      return {
        exam_id: examId,
        results_published: !!exam.results_published,
        progress: { total: subs.length, graded, pending: subs.length - graded },
        essay_questions,
        submissions: subs.map((s) => {
          const u = users.get(s.student_id);
          return {
            submission_id: s.id,
            student: { ...(u ? brief(u) : { id: s.student_id, username: '', name: '' }), class_name: classes.get(s.class_id) ?? '' },
            status: s.status, submitted_at: s.submitted_at, objective_score: s.objective_score ?? 0, total_score: s.total_score ?? null,
            ...essayProgress(pqs, ansBySub.get(s.id) || new Map()),
          };
        }),
      };
    },

    async byQuestion(user, examId, pqId, now) {
      await ownExam(user, examId);
      await svc.answer.sweepExam(examId, now);
      const exam = await repos.exams.findById(examId);
      const pq = await repos.papers.findQuestion(pqId);
      if (!pq || pq.paper_id !== exam.paper_id || pq.type !== 'essay') throw fail('NOT_FOUND', '该考试中不存在此简答题');
      const subs = (await repos.submissions.listByExam(examId)).filter((s) => s.status !== 'in_progress' && s.submit_type !== 'absent');
      const ans = new Map((await repos.submissions.answersOfMany(subs.map((s) => s.id))).filter((a) => a.paper_question_id === pqId).map((a) => [a.submission_id, a]));
      const users = new Map((await repos.users.findMany((u) => u.role === 'student')).map((u) => [u.id, u]));
      const items = subs.map((s) => {
        const a = ans.get(s.id);
        const u = users.get(s.student_id);
        return {
          submission_id: s.id, student: u ? brief(u) : { id: s.student_id, username: '', name: '' },
          response: a?.response ?? null, score: a?.score ?? null, comment: a?.comment ?? null, graded_at: a?.graded_at ?? null,
          _sa: s.submitted_at || '',
        };
      });
      items.sort((a, b) => (a.score === null ? 0 : 1) - (b.score === null ? 0 : 1) || a._sa.localeCompare(b._sa) || a.submission_id - b.submission_id);
      items.forEach((i) => delete i._sa);
      return {
        question: {
          paper_question_id: pq.id, seq: pq.seq, stem: pq.stem, score: pq.score,
          reference_answer: typeof pq.answer === 'string' ? pq.answer : null, analysis: pq.analysis ?? '',
        },
        items,
      };
    },

    async publish(user, examId, body, now) {
      const vd = new Validator(body || {});
      const allow_review = vd.bool('allow_review', { def: true, label: '允许查看答案' });
      vd.check();
      await ownExam(user, examId);
      await svc.answer.sweepExam(examId, now);
      const exam = await repos.transaction(async (tx) => {
        const e = await ownExam(user, examId, tx);
        if (examStatus(e, now) !== 'ended') throw fail('STATE_CONFLICT', '考试结束后才能发布成绩');
        if (e.results_published) throw fail('RESULTS_PUBLISHED', '成绩已发布');
        const pending = await tx.submissions.count((s) => s.exam_id === examId && (s.status === 'pending_review' || s.status === 'in_progress'));
        if (pending > 0) throw fail('GRADING_INCOMPLETE', `尚有 ${pending} 份答卷未完成批改`, { pending_count: pending });
        return tx.exams.update(examId, { results_published: true, results_published_at: now.toISOString(), allow_review });
      });
      return svc.exam.toExamView(exam, now);
    },

    async unpublish(user, examId, now) {
      const exam = await repos.transaction(async (tx) => {
        const e = await ownExam(user, examId, tx);
        if (!e.results_published) throw fail('STATE_CONFLICT', '成绩尚未发布');
        return tx.exams.update(examId, { results_published: false, results_published_at: null });
      });
      return svc.exam.toExamView(exam, now);
    },

    /** 教师/管理员查看答卷详情 */
    async submissionDetail(user, subId) {
      const sub = await repos.submissions.findById(subId);
      if (!sub) throw fail('NOT_FOUND', '答卷不存在');
      const exam = await svc.exam.accessible(user, sub.exam_id);
      const paper = await repos.papers.findById(exam.paper_id);
      const pqs = await repos.papers.listQuestions(exam.paper_id);
      const answerMap = new Map((await repos.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
      const stu = await repos.users.findById(sub.student_id);
      const cls = sub.class_id ? await repos.classes.findById(sub.class_id) : null;
      return {
        exam: { id: exam.id, title: exam.title, total_score: paper?.total_score ?? 0, pass_score: exam.pass_score, results_published: !!exam.results_published },
        student: { ...(stu ? brief(stu) : { id: sub.student_id, username: '', name: '' }), class_id: sub.class_id ?? null, class_name: cls?.name ?? '' },
        submission: submissionScore(sub, exam),
        questions: reviewQuestions(pqs, answerMap, sub),
      };
    },

    async studentResults(user, query, now) {
      const pg = parsePage(query);
      const subs0 = await repos.submissions.listByStudent(user.id);
      for (const s of subs0) if (s.status === 'in_progress') await svc.answer.sweepExam(s.exam_id, now);
      const subs = (await repos.submissions.listByStudent(user.id))
        .filter((s) => s.status !== 'in_progress')
        .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || '') || b.id - a.id);
      const page = paginate(subs, pg);
      page.items = await Promise.all(page.items.map(async (s) => {
        const exam = await repos.exams.findById(s.exam_id);
        const paper = await repos.papers.findById(exam.paper_id);
        const pub = !!exam.results_published;
        return {
          exam_id: exam.id, exam_title: exam.title, submission_id: s.id, status: s.status, submit_type: s.submit_type ?? null,
          submitted_at: s.submitted_at ?? null, results_published: pub, total_score: pub ? s.total_score ?? null : null,
          full_score: paper?.total_score ?? 0, passed: pub && s.total_score != null ? s.total_score >= exam.pass_score - 1e-9 : null,
        };
      }));
      return page;
    },

    async studentResult(user, examId, now) {
      const exam0 = await repos.exams.findById(examId);
      if (!exam0) throw fail('NOT_FOUND', '考试不存在');
      await svc.answer.sweepExam(examId, now);
      const sub = await repos.submissions.findByExamStudent(examId, user.id);
      if (!sub) throw fail('NOT_FOUND', '本人在该考试中没有答卷');
      if (sub.student_id !== user.id) throw fail('FORBIDDEN_OWNER');
      const exam = await repos.exams.findById(examId);
      const paper = await repos.papers.findById(exam.paper_id);
      const pub = !!exam.results_published;
      const allow = exam.allow_review !== false;
      let questions = [];
      if (pub && allow) {
        const pqs = await repos.papers.listQuestions(exam.paper_id);
        const answerMap = new Map((await repos.submissions.answersOf(sub.id)).map((a) => [a.paper_question_id, a]));
        questions = reviewQuestions(pqs, answerMap, sub);
      }
      return {
        exam: { id: exam.id, title: exam.title, total_score: paper?.total_score ?? 0, pass_score: exam.pass_score },
        submission: submissionScore(sub, exam, { hideScores: !pub }),
        results_published: pub,
        allow_review: allow,
        questions,
      };
    },
  };
}
