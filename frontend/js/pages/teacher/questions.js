// 教师首页：题库检索/汇总/预览/删除（FR-QB-02/03）
import { h, pageHead, loadInto, badge, append, mount } from '../../utils/dom.js';
import { TYPE_LABEL, TYPE_SHORT, DIFF_LABEL, TYPES, DIFFS, options, truncate, fmtScore, fmtDateTime } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { selectEl } from '../../components/form.js';
import { confirm, toast, openModal } from '../../components/modal.js';
import { renderQuestion } from '../../components/question-view.js';
import * as api from '../../api.js';
import { setQuery, reload, navigate } from '../../router.js';

export function previewQuestionDialog(q) {
  openModal({ title: `题目详情 #${q.id}`, wide: true, closeOnMask: true, body: h('div', null,
    renderQuestion({ ...q, seq: q.id }, 'preview', { showAnswer: true, number: '' }),
    h('div', { class: 'muted small' }, `被 ${q.ref_count ?? 0} 份试卷引用 · 创建于 ${fmtDateTime(q.created_at)} · 更新于 ${fmtDateTime(q.updated_at)}`)) });
}

export default {
  async render(container, params, query) {
    const selTags = new Set((query.tags || '').split(',').filter(Boolean));
    const q = {
      type: query.type || '', difficulty: query.difficulty || '', keyword: query.keyword || '',
      tags: [...selTags].join(','), page: Number(query.page) || 1, page_size: 10,
    };
    const typeSel = selectEl([{ value: '', label: '全部题型' }, ...options(TYPE_LABEL)], q.type);
    const diffSel = selectEl([{ value: '', label: '全部难度' }, ...options(DIFF_LABEL)], q.difficulty);
    const kw = h('input', { type: 'search', placeholder: '题干关键字', value: q.keyword, maxlength: 50 });
    const search = (extra = {}) => setQuery({ type: typeSel.value, difficulty: diffSel.value, keyword: kw.value.trim(), tags: [...selTags].join(','), page: 1, ...extra });
    typeSel.addEventListener('change', () => search());
    diffSel.addEventListener('change', () => search());
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

    const tagBox = h('div', { class: 'chips' });
    api.listTags().then((tags) => {
      if (!tags.length) return;
      mount(tagBox, h('span', { class: 'muted small' }, '知识点：'), tags.map((t) => h('button', {
        class: ['chip', selTags.has(t.name) && 'active'], type: 'button',
        onclick: () => { selTags.has(t.name) ? selTags.delete(t.name) : selTags.add(t.name); search(); },
      }, `${t.name} (${t.question_count})`)));
    }).catch(() => {});

    const summaryEl = h('div');
    const listEl = h('div');
    append(container, 
      pageHead('题库管理', [
        h('a', { class: 'btn', href: '#/teacher/tags' }, '标签管理'),
        h('a', { class: 'btn', href: '#/teacher/questions/import' }, '批量导入'),
        h('a', { class: 'btn btn-primary', href: '#/teacher/questions/new' }, '+ 新增题目'),
      ]),
      h('div', { class: 'card' },
        h('div', { class: 'filters' }, typeSel, diffSel, kw, h('button', { class: 'btn', onclick: () => search() }, '查询'),
          (q.type || q.difficulty || q.keyword || q.tags) ? h('button', { class: 'btn btn-ghost', onclick: () => navigate('#/teacher/questions') }, '清空条件') : null),
        tagBox, summaryEl, listEl));

    const remove = async (item) => {
      const msg = item.ref_count > 0
        ? `该题已被 ${item.ref_count} 份试卷引用。删除后不再出现在题库与选题列表中，已组试卷中的题目快照不受影响。\n确定删除吗？`
        : '确定删除该题目吗？';
      if (!(await confirm('删除题目', msg, { danger: true, okText: '删除' }))) return;
      try { await api.deleteQuestion(item.id); toast('已删除', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
    };

    const columns = [
      { title: 'ID', key: 'id', className: 'nowrap' },
      { title: '题型', className: 'nowrap', render: (x) => badge(TYPE_SHORT[x.type] || x.type, 'primary') },
      { title: '题干', render: (x) => h('button', { class: 'link-btn cell-ellipsis', title: x.stem, onclick: () => previewQuestionDialog(x) }, truncate(x.stem, 50)) },
      { title: '难度', className: 'nowrap', render: (x) => DIFF_LABEL[x.difficulty] || x.difficulty },
      { title: '知识点', render: (x) => ((x.tags || []).length ? h('span', null, x.tags.map((t) => h('span', { class: 'tag' }, t))) : '—') },
      { title: '分值', className: 'num', render: (x) => fmtScore(x.score) },
      { title: '引用', className: 'num', render: (x) => String(x.ref_count ?? 0) },
      {
        title: '操作', className: 'nowrap', render: (x) => h('div', { class: 'btn-group' },
          h('button', { class: 'link-btn', onclick: () => previewQuestionDialog(x) }, '查看'),
          h('a', { class: 'link-btn', href: `#/teacher/questions/${x.id}/edit` }, '编辑'),
          h('button', { class: 'link-btn danger', onclick: () => remove(x) }, '删除')),
      },
    ];

    await loadInto(listEl, () => api.listQuestions(q), (data) => {
      const s = data.summary || {};
      const bt = s.by_type || {}; const bd = s.by_difficulty || {};
      mount(summaryEl, h('div', { class: 'row small muted mb mt' },
        h('span', '筛选结果汇总：'),
        TYPES.map((t) => h('span', { class: 'chip' }, `${TYPE_SHORT[t]} ${bt[t] ?? 0}`)),
        h('span', ' | '),
        DIFFS.map((d) => h('span', { class: 'chip' }, `${DIFF_LABEL[d]} ${bd[d] ?? 0}`))));
      return [
        renderTable(columns, data.items, { empty: q.keyword || q.type || q.difficulty || q.tags ? '没有符合条件的题目' : '题库为空，点击右上角“新增题目”开始录入' }),
        renderPagination(data, (p) => setQuery({ page: p })),
      ];
    });
  },
};
