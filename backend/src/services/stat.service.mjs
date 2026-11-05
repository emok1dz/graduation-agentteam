// 统计：成绩单、概要、分数段、每题分析、CSV、系统概览
import { validationError } from '../core/errors.mjs';
import { Validator } from '../core/validator.mjs';
import { examStatus } from '../domain/exam-status.mjs';
import { summarize, distribution, questionStats, rankRows } from '../domain/statistics.mjs';
import { toCsv } from '../domain/csv.mjs';

const STATUS_LABEL = { not_started: '未开始', in_progress: '作答中', pending_review: '待批改', graded: '已批改' };
const SUBMIT_LABEL = { manual: '手动交卷', auto: '到时自动交卷', forced: '超时强制交卷', absent: '缺考' };

export function createStatService({ repos, svc }) {
  /** 公共前置：访问校验 + 兜底 + class_id 过滤校验 */
  async function prepare(user, examId, query, now) {
    await svc.exam.accessible(user, examId);
    await svc.answer.sweepExam(examId, now);
    const exam = await repos.exams.findById(examId);
    const examClassIds = await repos.exams.classIdsOf(examId);
    const vd = new Validator(query, { query: true });
    const class_id = vd.int('class_id', { min: 1, label: '班级' });
    vd.check();
    if (class_id !== undefined && !examClassIds.includes(class_id)) {
      throw validationError([{ field: 'class_id', message: '班级不是该考试的参考班级' }]);
    }
    const selected = class_id !== undefined ? [class_id] : examClassIds;
    const paper = await repos.papers.findById(exam.paper_id);
    const parts = await svc.exam.participants(exam, selected);
    return { exam, paper, parts, selected, examClassIds, status: examStatus(exam, now) };
  }

  function toRows(parts, exam) {
    const rows = parts.map(({ user: u, sub, class_id, class_name }) => ({
      student_id: u.id, username: u.username, name: u.name, class_id, class_name,
      submission_id: sub?.id ?? null, status: sub ? sub.status : 'not_started', submit_type: sub?.submit_type ?? null,
      submitted_at: sub?.submitted_at ?? null, objective_score: sub?.objective_score ?? null,
      subjective_score: sub?.subjective_score ?? null, total_score: sub?.status === 'graded' ? sub.total_score ?? null : null,
      passed: sub?.status === 'graded' && sub.total_score != null ? sub.total_score >= exam.pass_score - 1e-9 : null,
    }));
    return rankRows(rows);
  }

  async function classBriefs(ids) {
    return (await repos.classes.findMany((c) => ids.includes(c.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((c) => ({ id: c.id, name: c.name }));
  }

  function metrics(parts, exam, ended) {
    const stat = parts.filter((p) => p.sub && p.sub.status === 'graded' && p.sub.submit_type !== 'absent').map((p) => p.sub);
    const absent = parts.filter((p) => (p.sub && p.sub.submit_type === 'absent') || (!p.sub && ended)).length;
    const pending = parts.filter((p) => p.sub && (p.sub.status === 'in_progress' || p.sub.status === 'pending_review')).length;
    const s = summarize(stat, exam.pass_score);
    return {
      expected_count: parts.length, actual_count: s.actual_count, absent_count: absent, pending_count: pending,
      average_score: s.average_score, max_score: s.max_score, min_score: s.min_score, pass_count: s.pass_count, pass_rate: s.pass_rate,
    };
  }

  async function scoreSheet(user, examId, query, now) {
    const vd = new Validator(query, { query: true });
    const sort = vd.enum('sort', ['total_desc', 'username_asc'], { def: 'total_desc', label: '排序' });
    vd.check();
    const { exam, paper, parts, examClassIds, status } = await prepare(user, examId, query, now);
    const rows = toRows(parts, exam);
    if (sort === 'username_asc') rows.sort((a, b) => a.username.localeCompare(b.username));
    else rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.username.localeCompare(b.username));
    return {
      exam: {
        id: exam.id, title: exam.title, total_score: paper?.total_score ?? 0, pass_score: exam.pass_score, status,
        results_published: !!exam.results_published, classes: await classBriefs(examClassIds),
      },
      items: rows,
    };
  }

  return {
    scoreSheet,

    async exportCsv(user, examId, query, now) {
      const sheet = await scoreSheet(user, examId, query, now);
      const headers = ['排名', '学号', '姓名', '班级', '状态', '交卷方式', '交卷时间', '客观分', '主观分', '总分', '是否及格'];
      const rows = sheet.items.map((r) => [
        r.rank ?? '', r.username, r.name, r.class_name,
        r.submit_type === 'absent' ? '缺考' : STATUS_LABEL[r.status] ?? r.status,
        r.submit_type ? SUBMIT_LABEL[r.submit_type] ?? r.submit_type : '',
        r.submitted_at ?? '', r.objective_score ?? '', r.subjective_score ?? '', r.total_score ?? '',
        r.passed === null ? '' : r.passed ? '是' : '否',
      ]);
      return { filename: `${sheet.exam.title}-成绩单.csv`, text: toCsv(headers, rows) };
    },

    async summary(user, examId, query, now) {
      const { exam, paper, parts, selected, status } = await prepare(user, examId, query, now);
      const ended = status === 'ended';
      const classes = await classBriefs(selected);
      return {
        ...metrics(parts, exam, ended),
        total_score: paper?.total_score ?? 0,
        pass_score: exam.pass_score,
        by_class: classes.map((c) => ({ class_id: c.id, class_name: c.name, ...metrics(parts.filter((p) => p.class_id === c.id), exam, ended) })),
      };
    },

    async distribution(user, examId, query, now) {
      const { paper, parts } = await prepare(user, examId, query, now);
      const stat = parts.filter((p) => p.sub && p.sub.status === 'graded' && p.sub.submit_type !== 'absent').map((p) => p.sub);
      const total = paper?.total_score ?? 0;
      return { total_score: total, actual_count: stat.length, buckets: distribution(stat, total) };
    },

    async questions(user, examId, query, now) {
      const vd = new Validator(query, { query: true });
      const sort = vd.enum('sort', ['seq', 'rate_asc'], { def: 'seq', label: '排序' });
      vd.check();
      const { exam, parts } = await prepare(user, examId, query, now);
      const stat = parts.filter((p) => p.sub && p.sub.status === 'graded' && p.sub.submit_type !== 'absent').map((p) => p.sub);
      const ids = stat.map((s) => s.id);
      const pqs = await repos.papers.listQuestions(exam.paper_id);
      const bySub = new Map();
      for (const a of await repos.submissions.answersOfMany(ids)) {
        if (!bySub.has(a.submission_id)) bySub.set(a.submission_id, new Map());
        bySub.get(a.submission_id).set(a.paper_question_id, a);
      }
      const items = questionStats(pqs, bySub, ids);
      if (sort === 'rate_asc') items.sort((a, b) => a.score_rate - b.score_rate || a.seq - b.seq);
      return { actual_count: ids.length, items };
    },

    async overview(now) {
      const users = await repos.users.findMany();
      const exams = await repos.exams.findMany();
      const ex = { not_started: 0, ongoing: 0, ended: 0, cancelled: 0, total: exams.length };
      for (const e of exams) ex[examStatus(e, now)]++;
      return {
        users: {
          admin: users.filter((u) => u.role === 'admin').length,
          teacher: users.filter((u) => u.role === 'teacher').length,
          student: users.filter((u) => u.role === 'student').length,
          total: users.length,
        },
        class_count: await repos.classes.count(),
        question_count: await repos.questions.count((q) => !q.deleted_at),
        paper_count: await repos.papers.count(),
        exams: ex,
      };
    },
  };
}
