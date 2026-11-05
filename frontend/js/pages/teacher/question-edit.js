// 新增/编辑题目：五种题型动态表单（FR-QB-01/02）
import { h, pageHead, loading, errorState, clear, append, mount } from '../../utils/dom.js';
import { TYPE_LABEL, DIFF_LABEL, options } from '../../utils/format.js';
import { field, selectEl, showFieldErrors, clearFieldErrors, applyApiError } from '../../components/form.js';
import { toast } from '../../components/modal.js';
import { renderQuestion } from '../../components/question-view.js';
import * as api from '../../api.js';
import { navigate } from '../../router.js';

const KEYS = 'ABCDEFGH'.split('');
const countBlanks = (stem) => (String(stem).match(/___/g) || []).length;

export default {
  async render(container, params) {
    const editing = !!params.id;
    append(container, loading());
    let q = null;
    let allTags = [];
    try {
      [q, allTags] = await Promise.all([editing ? api.getQuestion(params.id) : Promise.resolve(null), api.listTags().catch(() => [])]);
    } catch (e) {
      mount(container, errorState(e, () => navigate(location.hash)));
      return;
    }
    container.replaceChildren();

    // ---------- 状态 ----------
    const state = {
      type: q ? q.type : 'single',
      stem: q ? q.stem : '',
      difficulty: q ? q.difficulty : 'medium',
      score: q ? q.score : 2,
      tags: q ? [...(q.tags || [])] : [],
      analysis: q ? q.analysis || '' : '',
      options: q && q.options && q.options.length ? q.options.map((o) => o.text) : ['', '', '', ''],
      single: q && q.type === 'single' ? q.answer : null,
      multiple: new Set(q && q.type === 'multiple' ? q.answer || [] : []),
      judge: q && q.type === 'judge' ? q.answer : null,
      fill: q && q.type === 'fill' ? (q.answer || []).map((a) => (Array.isArray(a) ? a.join('|') : String(a))) : [],
      essay: q && q.type === 'essay' ? q.answer || '' : '',
    };

    // ---------- 公共字段 ----------
    const typeSel = selectEl(options(TYPE_LABEL), state.type);
    const stemTa = h('textarea', { rows: 4, maxlength: 2000, placeholder: '请输入题干' });
    stemTa.value = state.stem;
    const stemHint = h('div', { class: 'hint' });
    const diffSel = selectEl(options(DIFF_LABEL), state.difficulty);
    const scoreIn = h('input', { type: 'number', min: 0.1, max: 100, step: 0.1, value: String(state.score) });
    const analysisTa = h('textarea', { rows: 3, maxlength: 2000, placeholder: '可选' });
    analysisTa.value = state.analysis;

    // 标签
    const tagInput = h('input', { type: 'text', placeholder: '输入标签后回车（最多 5 个）', maxlength: 20, list: 'tag-suggest' });
    const tagList = h('datalist', { id: 'tag-suggest' }, allTags.map((t) => h('option', { value: t.name })));
    const tagChips = h('div', { class: 'chips' });
    const suggest = h('div', { class: 'chips mt' });
    const renderTags = () => {
      mount(tagChips, ...state.tags.map((t) => h('span', { class: 'chip active' }, t,
        h('button', { class: 'x', type: 'button', 'aria-label': '移除', onclick: () => { state.tags = state.tags.filter((x) => x !== t); renderTags(); } }, '×'))));
      const rest = allTags.filter((t) => !state.tags.includes(t.name)).slice(0, 20);
      mount(suggest, ...(rest.length ? [h('span', { class: 'muted small' }, '常用：'), ...rest.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => addTag(t.name) }, t.name))] : []));
    };
    const addTag = (name) => {
      const n = String(name || '').trim();
      if (!n) return;
      if (n.length > 20) { toast('标签不超过 20 字', 'warning'); return; }
      if (state.tags.includes(n)) return;
      if (state.tags.length >= 5) { toast('最多 5 个标签', 'warning'); return; }
      state.tags.push(n); renderTags();
    };
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; }
    });
    tagInput.addEventListener('change', () => { if (allTags.some((t) => t.name === tagInput.value)) { addTag(tagInput.value); tagInput.value = ''; } });
    renderTags();

    // ---------- 题型相关区 ----------
    const typeArea = h('div');
    function renderTypeArea() {
      clear(typeArea);
      const t = state.type;
      stemHint.textContent = t === 'fill' ? `填空题用 ___（三个下划线）标记空位，当前 ${countBlanks(stemTa.value)} 个空` : '';
      if (t === 'single' || t === 'multiple') {
        const rows = state.options.map((text, i) => {
          const key = KEYS[i];
          const mark = t === 'single'
            ? h('input', { type: 'radio', name: 'correct', checked: state.single === key, onchange: () => { state.single = key; } })
            : h('input', { type: 'checkbox', checked: state.multiple.has(key), onchange: (e) => { e.target.checked ? state.multiple.add(key) : state.multiple.delete(key); } });
          const inp = h('input', { type: 'text', value: text, maxlength: 500, placeholder: `选项 ${key} 内容` });
          inp.addEventListener('input', () => { state.options[i] = inp.value; });
          return h('div', { class: 'option-editor-row', dataset: { field: `options[${i}]` } },
            h('span', { class: 'opt-key' }, key), inp,
            h('label', { class: 'check small' }, mark, '正确'),
            h('button', { class: 'link-btn danger', type: 'button', disabled: state.options.length <= 2, onclick: () => removeOption(i) }, '删除'),
            h('div', { class: 'error', hidden: true }));
        });
        append(typeArea, h('div', { class: 'field', dataset: { field: 'options' } },
          h('label', null, '选项', h('span', { class: 'req' }, '*'), h('span', { class: 'muted small' }, t === 'single' ? '（勾选 1 个正确答案）' : '（勾选至少 2 个正确答案）')),
          rows,
          h('div', null, h('button', { class: 'btn btn-sm', type: 'button', disabled: state.options.length >= 8, onclick: () => { state.options.push(''); renderTypeArea(); } }, '+ 添加选项')),
          h('div', { class: 'error', hidden: true })));
        append(typeArea, h('div', { class: 'field', dataset: { field: 'answer' } }, h('div', { class: 'error', hidden: true })));
      } else if (t === 'judge') {
        const mk = (v, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'judge', checked: state.judge === v, onchange: () => { state.judge = v; } }), label);
        append(typeArea, field('正确答案', h('div', { class: 'row' }, mk(true, '正确'), mk(false, '错误')), { name: 'answer', required: true }));
      } else if (t === 'fill') {
        const n = countBlanks(stemTa.value);
        while (state.fill.length < n) state.fill.push('');
        const rows = [];
        for (let i = 0; i < n; i++) {
          const inp = h('input', { type: 'text', value: state.fill[i] || '', placeholder: '可接受答案，多个用 | 分隔，如：北京|Beijing' });
          inp.addEventListener('input', () => { state.fill[i] = inp.value; });
          rows.push(h('div', { class: 'option-editor-row', dataset: { field: `answer[${i}]` } }, h('span', { class: 'opt-key' }, String(i + 1)), inp, h('div', { class: 'error', hidden: true })));
        }
        append(typeArea, h('div', { class: 'field', dataset: { field: 'answer' } },
          h('label', null, '各空答案', h('span', { class: 'req' }, '*')),
          n ? rows : h('div', { class: 'muted' }, '请先在题干中用 ___ 标记空位'),
          h('div', { class: 'hint' }, '判分时忽略首尾空格与英文大小写；命中任一可接受答案即得该空分'),
          h('div', { class: 'error', hidden: true })));
      } else if (t === 'essay') {
        const ta = h('textarea', { rows: 4, maxlength: 2000, placeholder: '供批改参考，可留空' });
        ta.value = state.essay;
        ta.addEventListener('input', () => { state.essay = ta.value; });
        append(typeArea, field('参考答案', ta, { name: 'answer' }));
      }
    }
    function removeOption(i) {
      state.options.splice(i, 1);
      const remap = (k) => { const idx = KEYS.indexOf(k); if (idx === i) return null; return idx > i ? KEYS[idx - 1] : k; };
      state.single = state.single ? remap(state.single) : null;
      state.multiple = new Set([...state.multiple].map(remap).filter(Boolean));
      renderTypeArea();
    }
    typeSel.addEventListener('change', () => { state.type = typeSel.value; renderTypeArea(); });
    stemTa.addEventListener('input', () => { if (state.type === 'fill') renderTypeArea(); });

    // ---------- 组装请求体 ----------
    function buildBody() {
      const t = state.type;
      const body = {
        type: t, stem: stemTa.value.trim(), difficulty: diffSel.value,
        score: scoreIn.value === '' ? null : Number(scoreIn.value),
        tags: state.tags, analysis: analysisTa.value.trim(),
      };
      if (t === 'single' || t === 'multiple') {
        body.options = state.options.map((text, i) => ({ key: KEYS[i], text: text.trim() }));
        body.answer = t === 'single' ? state.single : [...state.multiple].filter((k) => KEYS.indexOf(k) < state.options.length).sort();
      } else if (t === 'judge') { body.options = []; body.answer = state.judge; } else if (t === 'fill') {
        const n = countBlanks(body.stem);
        body.options = [];
        body.answer = state.fill.slice(0, n).map((s) => String(s).split('|').map((x) => x.trim()).filter(Boolean));
      } else { body.options = []; body.answer = state.essay.trim() ? state.essay.trim() : null; }
      return body;
    }
    function validate(b) {
      const e = [];
      if (!b.stem) e.push({ field: 'stem', message: '请输入题干' });
      if (b.score == null || !(b.score > 0) || b.score > 100 || Math.round(b.score * 10) !== b.score * 10) e.push({ field: 'score', message: '分值须为 0~100 之间的正数，最多 1 位小数' });
      if (b.type === 'single' || b.type === 'multiple') {
        b.options.forEach((o, i) => { if (!o.text) e.push({ field: `options[${i}].text`, message: '选项内容不能为空' }); });
        if (b.type === 'single' && !b.answer) e.push({ field: 'answer', message: '请选择正确答案' });
        if (b.type === 'multiple' && b.answer.length < 2) e.push({ field: 'answer', message: '多选题至少需要 2 个正确答案' });
      }
      if (b.type === 'judge' && typeof b.answer !== 'boolean') e.push({ field: 'answer', message: '请选择正确答案' });
      if (b.type === 'fill') {
        if (!b.answer.length) e.push({ field: 'stem', message: '填空题题干中至少需要 1 个 ___ 空位' });
        b.answer.forEach((a, i) => { if (!a.length) e.push({ field: `answer[${i}]`, message: '请填写该空的可接受答案' }); else if (a.length > 10) e.push({ field: `answer[${i}]`, message: '每空最多 10 个可接受答案' }); });
      }
      return e;
    }

    const formEl = h('div', { class: 'form' });
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '保存');
    const saveNextBtn = editing ? null : h('button', { class: 'btn', type: 'button' }, '保存并继续新增');
    const previewBtn = h('button', { class: 'btn', type: 'button' }, '预览');
    const previewBox = h('div');

    async function save(next) {
      clearFieldErrors(formEl);
      const body = buildBody();
      const errs = validate(body);
      if (errs.length) { showFieldErrors(formEl, errs); toast('请检查标红的字段', 'error'); return; }
      saveBtn.disabled = true; if (saveNextBtn) saveNextBtn.disabled = true;
      try {
        if (editing) await api.updateQuestion(params.id, body); else await api.createQuestion(body);
        toast('题目已保存', 'success');
        if (next) navigate('#/teacher/questions/new?t=' + Date.now());
        else navigate('#/teacher/questions');
      } catch (e) {
        applyApiError(e, formEl);
      } finally { saveBtn.disabled = false; if (saveNextBtn) saveNextBtn.disabled = false; }
    }
    saveBtn.onclick = () => save(false);
    if (saveNextBtn) saveNextBtn.onclick = () => save(true);
    previewBtn.onclick = () => {
      const b = buildBody();
      mount(previewBox, h('div', { class: 'card' }, h('h3', '预览'), renderQuestion({ ...b, id: 0, seq: 1, blank_count: countBlanks(b.stem) }, 'preview', { showAnswer: true })));
    };

    append(formEl, 
      h('div', { class: 'form-row' },
        field('题型', typeSel, { name: 'type', required: true }),
        field('难度', diffSel, { name: 'difficulty', required: true }),
        field('默认分值', scoreIn, { name: 'score', required: true, hint: '正数，最多 1 位小数' })),
      h('div', { class: 'field', dataset: { field: 'stem' } }, h('label', null, '题干', h('span', { class: 'req' }, '*')), stemTa, stemHint, h('div', { class: 'error', hidden: true })),
      typeArea,
      h('div', { class: 'field', dataset: { field: 'tags' } }, h('label', null, '知识点标签'), tagChips, tagInput, tagList, suggest, h('div', { class: 'error', hidden: true })),
      field('解析', analysisTa, { name: 'analysis' }));
    renderTypeArea();

    append(container, 
      pageHead(editing ? `编辑题目 #${params.id}` : '新增题目', [h('a', { class: 'btn', href: '#/teacher/questions' }, '返回题库')],
        [{ label: '题库管理', href: '#/teacher/questions' }, { label: editing ? '编辑题目' : '新增题目' }]),
      editing && q.ref_count > 0 ? h('div', { class: 'alert alert-info' }, `该题已被 ${q.ref_count} 份试卷引用；修改不影响已组试卷中的题目快照。`) : null,
      h('div', { class: 'card' }, formEl),
      previewBox,
      h('div', { class: 'sticky-actions' }, previewBtn, saveNextBtn, saveBtn));
  },
};
