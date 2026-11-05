// 试卷列表：预览/编辑/复制/删除/发布考试（FR-PAPER-03）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtDateTime, fmtScore } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { confirm, toast, formDialog } from '../../components/modal.js';
import * as api from '../../api.js';
import { setQuery, reload, navigate } from '../../router.js';

export async function copyPaperFlow(p) {
  const res = await formDialog({
    title: '复制为新试卷',
    fields: [{ name: 'title', label: '新试卷名称', required: true, attrs: { maxlength: 100 } }],
    initial: { title: `${p.title}（副本）` },
    submitText: '复制',
    onSubmit: (v) => api.copyPaper(p.id, { title: v.title }),
  });
  if (res && res.id) { toast('已复制，可继续编辑', 'success'); navigate(`#/teacher/papers/${res.id}/edit`); }
}

export default {
  async render(container, params, query) {
    const q = { keyword: query.keyword || '', page: Number(query.page) || 1, page_size: 10 };
    const kw = h('input', { type: 'search', placeholder: '试卷名称', value: q.keyword, maxlength: 50 });
    const search = () => setQuery({ keyword: kw.value.trim(), page: 1 });
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    const listEl = h('div');
    append(container, 
      pageHead('试卷管理', [h('a', { class: 'btn btn-primary', href: '#/teacher/papers/new' }, '+ 新建试卷')]),
      h('div', { class: 'card' }, h('div', { class: 'filters' }, kw, h('button', { class: 'btn', onclick: search }, '查询')), listEl));

    const remove = async (p) => {
      if (!(await confirm('删除试卷', `确定删除试卷「${p.title}」吗？此操作不可恢复。`, { danger: true, okText: '删除' }))) return;
      try { await api.deletePaper(p.id); toast('已删除', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
    };
    const columns = [
      { title: '试卷名称', render: (p) => h('a', { href: `#/teacher/papers/${p.id}` }, p.title) },
      { title: '题量', className: 'num', render: (p) => String(p.question_count) },
      { title: '总分', className: 'num', render: (p) => fmtScore(p.total_score) },
      { title: '考试引用', className: 'num', render: (p) => String(p.exam_ref_count ?? 0) },
      { title: '状态', render: (p) => (p.locked ? badge('已锁定', 'warning') : badge('可编辑', 'success')) },
      { title: '创建时间', className: 'nowrap', render: (p) => fmtDateTime(p.created_at) },
      {
        title: '操作', className: 'nowrap', render: (p) => h('div', { class: 'btn-group' },
          h('a', { class: 'link-btn', href: `#/teacher/papers/${p.id}` }, '预览'),
          p.locked ? h('button', { class: 'link-btn', disabled: true, title: '已被考试引用，不能编辑' }, '编辑') : h('a', { class: 'link-btn', href: `#/teacher/papers/${p.id}/edit` }, '编辑'),
          h('button', { class: 'link-btn', onclick: () => copyPaperFlow(p) }, '复制'),
          h('a', { class: 'link-btn', href: `#/teacher/exams/new?paper_id=${p.id}` }, '发布考试'),
          h('button', { class: 'link-btn danger', disabled: p.locked, title: p.locked ? '已被考试引用，不能删除' : '', onclick: () => remove(p) }, '删除')),
      },
    ];
    await loadInto(listEl, () => api.listPapers(q), (data) => [
      renderTable(columns, data.items, { empty: '暂无试卷，点击右上角“新建试卷”开始组卷' }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
