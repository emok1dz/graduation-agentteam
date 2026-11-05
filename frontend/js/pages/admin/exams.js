// 管理员：全部考试只读列表 → 成绩单/统计
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtRange, EXAM_STATUS_LABEL, EXAM_STATUS_KIND, options } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { selectEl } from '../../components/form.js';
import * as api from '../../api.js';
import { setQuery } from '../../router.js';

export default {
  async render(container, params, query) {
    const q = { status: query.status || '', keyword: query.keyword || '', page: Number(query.page) || 1, page_size: 10 };
    const st = selectEl([{ value: '', label: '全部状态' }, ...options(EXAM_STATUS_LABEL)], q.status);
    const kw = h('input', { type: 'search', placeholder: '考试名称', value: q.keyword, maxlength: 50 });
    const search = () => setQuery({ status: st.value, keyword: kw.value.trim(), page: 1 });
    st.addEventListener('change', search);
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    const listEl = h('div');
    append(container, pageHead('考试总览'),
      h('div', { class: 'card' }, h('div', { class: 'filters' }, st, kw, h('button', { class: 'btn', onclick: search }, '查询')), listEl));
    const columns = [
      { title: '考试名称', key: 'title' },
      { title: '教师', render: (e) => (e.teacher ? e.teacher.name : '—') },
      { title: '试卷', key: 'paper_title' },
      { title: '参考班级', render: (e) => (e.classes || []).map((c) => c.name).join('、') },
      { title: '时间窗口', className: 'nowrap', render: (e) => fmtRange(e.start_time, e.end_time) },
      { title: '状态', render: (e) => badge(EXAM_STATUS_LABEL[e.status] || e.status, EXAM_STATUS_KIND[e.status]) },
      { title: '应考/已交/待批', className: 'nowrap', render: (e) => { const c = e.counts || {}; return `${c.expected ?? 0} / ${c.submitted ?? 0} / ${c.pending_review ?? 0}`; } },
      { title: '成绩', render: (e) => (e.results_published ? badge('已发布', 'success') : badge('未发布', 'muted')) },
      { title: '操作', className: 'nowrap', render: (e) => (e.status === 'cancelled' ? '—' : h('a', { class: 'link-btn', href: `#/exams/${e.id}/scores` }, '成绩统计')) },
    ];
    await loadInto(listEl, () => api.listExams(q), (data) => [
      renderTable(columns, data.items, { empty: '暂无考试' }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
