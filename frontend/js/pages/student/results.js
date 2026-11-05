// 我的成绩列表（FR-STAT-01）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtDateTime, fmtScore, SUBMIT_TYPE_LABEL } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import * as api from '../../api.js';
import { setQuery, navigate } from '../../router.js';

export default {
  async render(container, params, query) {
    const q = { page: Number(query.page) || 1, page_size: 10 };
    const listEl = h('div');
    append(container, pageHead('我的成绩'), h('div', { class: 'card' }, listEl));
    await loadInto(listEl, () => api.listStudentResults(q), (data) => [
      renderTable([
        { title: '考试名称', key: 'exam_title' },
        { title: '交卷时间', className: 'nowrap', render: (r) => fmtDateTime(r.submitted_at) },
        { title: '交卷方式', render: (r) => SUBMIT_TYPE_LABEL[r.submit_type] || '—' },
        { title: '成绩', className: 'nowrap', render: (r) => (r.results_published ? h('strong', `${fmtScore(r.total_score)} / ${fmtScore(r.full_score)}`) : h('span', { class: 'muted' }, r.status === 'pending_review' ? '已交卷，待批改' : '已交卷，待发布')) },
        { title: '是否及格', render: (r) => (r.passed == null ? '—' : r.passed ? badge('及格', 'success') : badge('不及格', 'danger')) },
        { title: '操作', render: (r) => h('a', { class: 'link-btn', href: `#/student/results/${r.exam_id}` }, '详情') },
      ], data.items, { empty: '暂无成绩记录', onRowClick: (r) => navigate(`#/student/results/${r.exam_id}`) }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
