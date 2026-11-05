// 试卷预览：学生视角，可切换显示答案与解析（FR-PAPER-03）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { TYPE_LABEL, TYPES, fmtScore, fmtDateTime } from '../../utils/format.js';
import { renderQuestion } from '../../components/question-view.js';
import { copyPaperFlow } from './papers.js';
import * as api from '../../api.js';

const CN = ['一', '二', '三', '四', '五'];

export default {
  async render(container, params) {
    const body = h('div');
    append(container, body);
    await loadInto(body, () => api.getPaper(params.id), (p) => {
      const qBox = h('div');
      const toggle = h('input', { type: 'checkbox' });
      const draw = () => {
        qBox.replaceChildren();
        let sec = 0;
        for (const t of TYPES) {
          const list = p.questions.filter((q) => q.type === t);
          if (!list.length) continue;
          const sub = list.reduce((s, q) => s + Number(q.score || 0), 0);
          append(qBox, h('div', { class: 'type-section-title' }, `${CN[sec++]}、${TYPE_LABEL[t]}（共 ${list.length} 题，${fmtScore(sub)} 分）`));
          for (const q of list) append(qBox, renderQuestion(q, 'preview', { showAnswer: toggle.checked }));
        }
        if (!p.questions.length) append(qBox, h('div', { class: 'state' }, '试卷没有题目'));
      };
      toggle.addEventListener('change', draw);
      draw();
      return [
        pageHead(p.title, [
          p.locked ? null : h('a', { class: 'btn', href: `#/teacher/papers/${p.id}/edit` }, '编辑'),
          h('button', { class: 'btn', onclick: () => copyPaperFlow(p) }, '复制为新试卷'),
          h('a', { class: 'btn btn-primary', href: `#/teacher/exams/new?paper_id=${p.id}` }, '用此试卷发布考试'),
        ], [{ label: '试卷管理', href: '#/teacher/papers' }, { label: '试卷预览' }]),
        h('div', { class: 'card' },
          h('div', { class: 'row mb' },
            p.locked ? badge(`已锁定（被 ${p.exam_ref_count} 场考试引用）`, 'warning') : badge('可编辑', 'success'),
            h('span', { class: 'muted small' }, `创建于 ${fmtDateTime(p.created_at)}`)),
          p.description ? h('p', { class: 'pre' }, p.description) : null,
          h('div', { class: 'stats-grid' },
            h('div', { class: 'stat primary' }, h('div', { class: 'stat-label' }, '总分'), h('div', { class: 'stat-value' }, fmtScore(p.total_score))),
            h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '题量'), h('div', { class: 'stat-value' }, String(p.question_count))),
            (p.type_stats || []).map((s) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, TYPE_LABEL[s.type] || s.type), h('div', { class: 'stat-value' }, String(s.count)), h('div', { class: 'stat-sub' }, `${fmtScore(s.score)} 分`)))),
          h('label', { class: 'check' }, toggle, '显示答案与解析')),
        qBox,
      ];
    });
  },
};
