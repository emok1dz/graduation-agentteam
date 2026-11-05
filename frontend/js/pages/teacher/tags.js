// 知识点标签管理（FR-QB-04，P1）
import { h, pageHead, loadInto, append } from '../../utils/dom.js';
import { fmtDateTime } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { formDialog, confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';

export default {
  async render(container) {
    const listEl = h('div');
    const load = () => loadInto(listEl, () => api.listTags(), (tags) => renderTable(columns, tags, { empty: '暂无标签，录入题目时填写的标签会自动创建' }));
    const edit = async (t) => {
      const ok = await formDialog({
        title: t ? `重命名标签 - ${t.name}` : '新建标签',
        fields: [{ name: 'name', label: '标签名称', required: true, attrs: { maxlength: 20 }, hint: '1~20 字，同一教师下唯一' }],
        initial: t ? { name: t.name } : {},
        onSubmit: (v) => (t ? api.renameTag(t.id, v) : api.createTag(v)),
      });
      if (ok) { toast('已保存', 'success'); load(); }
    };
    const remove = async (t) => {
      if (!(await confirm('删除标签', `确定删除标签「${t.name}」吗？将从 ${t.question_count} 道关联题目中移除该标签，题目本身不会被删除。`, { danger: true, okText: '删除' }))) return;
      try { await api.deleteTag(t.id); toast('已删除', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
    };
    const columns = [
      { title: '标签名称', render: (t) => h('span', { class: 'tag' }, t.name) },
      { title: '关联题目数', className: 'num', render: (t) => h('a', { href: `#/teacher/questions?tags=${encodeURIComponent(t.name)}` }, String(t.question_count ?? 0)) },
      { title: '创建时间', render: (t) => fmtDateTime(t.created_at) },
      { title: '操作', className: 'nowrap', render: (t) => h('div', { class: 'btn-group' },
        h('button', { class: 'link-btn', onclick: () => edit(t) }, '重命名'),
        h('button', { class: 'link-btn danger', onclick: () => remove(t) }, '删除')) },
    ];
    append(container, pageHead('知识点标签', [h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, '+ 新建标签')],
      [{ label: '题库管理', href: '#/teacher/questions' }, { label: '知识点标签' }]), h('div', { class: 'card' }, listEl));
    load();
  },
};
