// 班级管理：列表/新增/编辑/删除（FR-CLASS-01）
import { h, pageHead, loadInto, append } from '../../utils/dom.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { formDialog, confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';
import { setQuery, reload } from '../../router.js';

const FIELDS = [
  { name: 'name', label: '班级名称', required: true, placeholder: '如：计科2101', attrs: { maxlength: 30 } },
  { name: 'grade', label: '年级', placeholder: '如：2021', attrs: { maxlength: 10 } },
  { name: 'major', label: '专业', placeholder: '如：计算机科学与技术', attrs: { maxlength: 30 } },
  { name: 'remark', label: '备注', type: 'textarea', rows: 3, attrs: { maxlength: 200 } },
];

export default {
  async render(container, params, query) {
    const q = { keyword: query.keyword || '', page: Number(query.page) || 1, page_size: 10 };
    const kw = h('input', { type: 'search', placeholder: '班级名称 / 专业', value: q.keyword, maxlength: 50 });
    const search = () => setQuery({ keyword: kw.value.trim(), page: 1 });
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    const listEl = h('div');

    const edit = async (c) => {
      const ok = await formDialog({
        title: c ? `编辑班级 - ${c.name}` : '新增班级',
        fields: FIELDS,
        initial: c || {},
        onSubmit: (v) => (c ? api.updateClass(c.id, v) : api.createClass(v)),
      });
      if (ok) { toast('已保存', 'success'); reload(); }
    };
    const remove = async (c) => {
      if (!(await confirm('删除班级', `确定删除班级「${c.name}」吗？\n班级下仍有学生或存在关联考试时不能删除。`, { danger: true, okText: '删除' }))) return;
      try { await api.deleteClass(c.id); toast('已删除', 'success'); reload(); } catch (e) { toast(e.message, 'error', 4000); }
    };

    append(container, 
      pageHead('班级管理', [h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, '+ 新增班级')]),
      h('div', { class: 'card' }, h('div', { class: 'filters' }, kw, h('button', { class: 'btn', onclick: search }, '查询')), listEl));

    const columns = [
      { title: '班级名称', render: (c) => h('a', { href: `#/admin/classes/${c.id}` }, c.name) },
      { title: '年级', key: 'grade' },
      { title: '专业', key: 'major' },
      { title: '学生人数', className: 'num', render: (c) => String(c.student_count ?? 0) },
      { title: '任课教师', render: (c) => (c.teachers || []).map((t) => t.name).join('、') || '—' },
      { title: '备注', render: (c) => h('div', { class: 'cell-ellipsis', title: c.remark || '' }, c.remark || '—') },
      {
        title: '操作', className: 'nowrap', render: (c) => h('div', { class: 'btn-group' },
          h('a', { class: 'link-btn', href: `#/admin/classes/${c.id}` }, '成员'),
          h('button', { class: 'link-btn', onclick: () => edit(c) }, '编辑'),
          h('button', { class: 'link-btn danger', onclick: () => remove(c) }, '删除')),
      },
    ];
    await loadInto(listEl, () => api.listClasses(q), (data) => [
      renderTable(columns, data.items, { empty: '暂无班级' }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
