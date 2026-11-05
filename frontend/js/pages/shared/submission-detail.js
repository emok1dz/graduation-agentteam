// 某学生答卷详情（教师/管理员，FR-STAT-02）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtDateTime, fmtScore, TYPES, TYPE_LABEL, SUB_STATUS_LABEL, SUB_STATUS_KIND, SUBMIT_TYPE_LABEL } from '../../utils/format.js';
import { renderQuestion } from '../../components/question-view.js';
import * as api from '../../api.js';
import * as store from '../../store.js';

export default {
  async render(container, params) {
    const user = store.getUser();
    const body = h('div');
    append(container, body);
    await loadInto(body, () => api.getSubmission(params.id), (d) => {
      const s = d.submission;
      const sections = [];
      for (const t of TYPES) {
        const list = d.questions.filter((q) => q.type === t);
        if (!list.length) continue;
        sections.push(h('div', { class: 'type-section-title' }, TYPE_LABEL[t]));
        list.forEach((q) => sections.push(renderQuestion(q, 'review')));
      }
      const actions = [h('a', { class: 'btn', href: `#/exams/${d.exam.id}/scores` }, '返回成绩单')];
      if (user.role === 'teacher' && s.status === 'pending_review') actions.push(h('a', { class: 'btn btn-primary', href: `#/teacher/exams/${d.exam.id}/grading` }, '去批改'));
      return [
        pageHead(`答卷详情 - ${d.student.name}`, actions, [{ label: d.exam.title, href: `#/exams/${d.exam.id}/scores` }, { label: '答卷详情' }]),
        h('div', { class: 'card' },
          h('dl', { class: 'kv' },
            h('dt', '学生'), h('dd', `${d.student.name}（${d.student.username}）· ${d.student.class_name || ''}`),
            h('dt', '考试'), h('dd', `${d.exam.title}（满分 ${fmtScore(d.exam.total_score)}，及格线 ${fmtScore(d.exam.pass_score)}）`),
            h('dt', '状态'), h('dd', badge(SUB_STATUS_LABEL[s.status] || s.status, SUB_STATUS_KIND[s.status]), ' ', s.submit_type ? SUBMIT_TYPE_LABEL[s.submit_type] || s.submit_type : ''),
            h('dt', '作答时间'), h('dd', `${fmtDateTime(s.started_at, true)} → ${fmtDateTime(s.submitted_at, true)}`),
            h('dt', '得分'), h('dd', `客观题 ${fmtScore(s.objective_score)} + 主观题 ${fmtScore(s.subjective_score)} = `, h('strong', fmtScore(s.total_score)), ' ',
              s.passed == null ? '' : s.passed ? badge('及格', 'success') : badge('不及格', 'danger')))),
        sections.length ? sections : h('div', { class: 'card' }, h('div', { class: 'state' }, '无作答记录')),
      ];
    });
  },
};
