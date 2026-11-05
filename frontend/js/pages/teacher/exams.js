// 我的考试列表（状态筛选、counts）（FR-EXAM-02）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtRange, EXAM_STATUS_LABEL, EXAM_STATUS_KIND } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';
import { setQuery, reload } from '../../router.js';

const TABS = [['', '全部'], ['not_started', '未开始'], ['ongoing', '进行中'], ['ended', '已结束'], ['cancelled', '已取消']];

export default {
  async render(container, params, query) {
    const q = { status: query.status || '', keyword: query.keyword || '', page: Number(query.page) || 1, page_size: 10 };
    const kw = h('input', { type: 'search', placeholder: '考试名称', value: q.keyword, maxlength: 50 });
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') setQuery({ keyword: kw.value.trim(), page: 1 }); });
    const tabs = h('div', { class: 'tabs' }, TABS.map(([v, l]) => h('button', { class: q.status === v ? 'active' : null, type: 'button', onclick: () => setQuery({ status: v, page: 1 }) }, l)));
    const listEl = h('div');
    append(container, 
      pageHead('考试管理', [h('a', { class: 'btn btn-primary', href: '#/teacher/exams/new' }, '+ 发布考试')]),
      h('div', { class: 'card' }, tabs, h('div', { class: 'filters' }, kw, h('button', { class: 'btn', onclick: () => setQuery({ keyword: kw.value.trim(), page: 1 }) }, '查询')), listEl));

    const cancel = async (e) => {
      if (!(await confirm('取消考试', `确定取消考试「${e.title}」吗？取消后学生将不可见，且不可恢复。`, { danger: true, okText: '取消考试', cancelText: '返回' }))) return;
      try { await api.cancelExam(e.id); toast('考试已取消', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    };
    const actions = (e) => {
      const a = [];
      const link = (href, text) => h('a', { class: 'link-btn', href }, text);
      if (e.status === 'not_started') {
        a.push(link(`#/teacher/exams/${e.id}/edit`, '修改'));
        a.push(h('button', { class: 'link-btn danger', onclick: () => cancel(e) }, '取消'));
      }
      if (e.status === 'ongoing') {
        a.push(link(`#/teacher/exams/${e.id}/monitor`, '监控'));
        a.push(link(`#/teacher/exams/${e.id}/edit`, '延长'));
        a.push(link(`#/teacher/exams/${e.id}/grading`, '批改'));
      }
      if (e.status === 'ended') {
        a.push(link(`#/teacher/exams/${e.id}/grading`, e.results_published ? '成绩发布' : '批改/发布'));
        a.push(link(`#/teacher/exams/${e.id}/monitor`, '作答记录'));
      }
      if (e.status === 'ongoing' || e.status === 'ended') a.push(link(`#/exams/${e.id}/scores`, '成绩统计'));
      return h('div', { class: 'btn-group' }, a.length ? a : '—');
    };
    const columns = [
      { title: '考试名称', render: (e) => h('div', null, h('div', null, e.title), h('div', { class: 'muted small' }, `试卷：${e.paper_title || '—'} · ${e.total_score} 分`)) },
      { title: '时间窗口', className: 'nowrap', render: (e) => h('div', null, h('div', null, fmtRange(e.start_time, e.end_time)), h('div', { class: 'muted small' }, `时长 ${e.duration_minutes} 分钟`)) },
      { title: '参考班级', render: (e) => (e.classes || []).map((c) => c.name).join('、') },
      { title: '状态', render: (e) => badge(EXAM_STATUS_LABEL[e.status] || e.status, EXAM_STATUS_KIND[e.status]) },
      { title: '应考', className: 'num', render: (e) => String(e.counts?.expected ?? 0) },
      { title: '已交卷', className: 'num', render: (e) => String(e.counts?.submitted ?? 0) },
      { title: '待批改', className: 'num', render: (e) => { const n = e.counts?.pending_review ?? 0; return n ? h('span', { class: 'text-warning' }, String(n)) : '0'; } },
      { title: '成绩', render: (e) => (e.results_published ? badge('已发布', 'success') : badge('未发布', 'muted')) },
      { title: '操作', className: 'nowrap', render: actions },
    ];
    await loadInto(listEl, () => api.listExams(q), (data) => [
      renderTable(columns, data.items, { empty: '暂无考试' }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
