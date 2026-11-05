// 成绩详情与答卷回顾（FR-STAT-01）
import { h, pageHead, loadInto, append } from '../../utils/dom.js';
import { fmtDateTime, fmtScore, TYPES, TYPE_LABEL, SUBMIT_TYPE_LABEL } from '../../utils/format.js';
import { renderQuestion } from '../../components/question-view.js';
import * as api from '../../api.js';

const stat = (label, value, kind = '') => h('div', { class: ['stat', kind] }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));

export default {
  async render(container, params) {
    const body = h('div');
    append(container, body);
    await loadInto(body, () => api.getStudentResult(params.examId), (d) => {
      const s = d.submission;
      const nodes = [pageHead(d.exam.title, [h('a', { class: 'btn', href: '#/student/results' }, '返回成绩列表')], [{ label: '我的成绩', href: '#/student/results' }, { label: '成绩详情' }])];
      nodes.push(h('div', { class: 'card row small muted' },
        h('span', `交卷时间：${fmtDateTime(s.submitted_at, true)}`),
        h('span', `交卷方式：${SUBMIT_TYPE_LABEL[s.submit_type] || '—'}`),
        h('span', `满分 ${fmtScore(d.exam.total_score)} · 及格线 ${fmtScore(d.exam.pass_score)}`)));
      if (!d.results_published) {
        nodes.push(h('div', { class: 'card' }, h('div', { class: 'state' }, h('div', { class: 'state-icon' }, '⏳'), h('div', '已交卷，成绩待发布'), h('div', { class: 'small' }, '教师发布成绩后即可在此查看得分与答卷回顾。'))));
        return nodes;
      }
      nodes.push(h('div', { class: 'stats-grid' },
        stat('总分', fmtScore(s.total_score), 'primary'),
        stat('客观题得分', fmtScore(s.objective_score)),
        stat('主观题得分', fmtScore(s.subjective_score)),
        h('div', { class: ['stat', s.passed ? 'success' : 'danger'] }, h('div', { class: 'stat-label' }, '结果'), h('div', { class: 'stat-value' }, s.passed ? '及格' : '不及格'))));
      if (s.submit_type === 'absent') { nodes.push(h('div', { class: 'alert alert-danger' }, '您未参加本场考试，记 0 分。')); return nodes; }
      if (!d.allow_review) { nodes.push(h('div', { class: 'alert alert-info' }, '教师未开放本场考试的答卷回顾。')); return nodes; }
      for (const t of TYPES) {
        const list = (d.questions || []).filter((q) => q.type === t);
        if (!list.length) continue;
        nodes.push(h('div', { class: 'type-section-title' }, TYPE_LABEL[t]));
        list.forEach((q) => nodes.push(renderQuestion(q, 'review')));
      }
      return nodes;
    });
  },
};
