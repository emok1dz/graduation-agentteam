// 组卷：手动选题 + 按题型随机抽题 → 替换/删除/追加/调分值/排序 → 保存（FR-PAPER-01/02/03）
import { h, pageHead, loading, errorState, loadInto, badge, clear, append, mount } from '../../utils/dom.js';
import { TYPE_LABEL, TYPE_SHORT, TYPE_ORDER, TYPES, DIFF_LABEL, options, truncate, fmtScore, round1 } from '../../utils/format.js';
import { field, selectEl, showFieldErrors, clearFieldErrors, applyApiError } from '../../components/form.js';
import { renderPagination } from '../../components/pagination.js';
import { renderTable } from '../../components/table.js';
import { toast, confirm } from '../../components/modal.js';
import { previewQuestionDialog } from './questions.js';
import { copyPaperFlow } from './papers.js';
import * as api from '../../api.js';
import { navigate } from '../../router.js';

const parseTags = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
const validScore = (s) => s != null && s > 0 && s <= 100 && Math.abs(Math.round(s * 10) - s * 10) < 1e-9;

export default {
  async render(container, params) {
    const editing = !!params.id;
    let paper = null;
    if (editing) {
      append(container, loading());
      try { paper = await api.getPaper(params.id); } catch (e) { mount(container, errorState(e, () => navigate(location.hash))); return; }
      container.replaceChildren();
      if (paper.locked) {
        append(container, 
          pageHead(`编辑试卷 - ${paper.title}`, [], [{ label: '试卷管理', href: '#/teacher/papers' }, { label: '编辑试卷' }]),
          h('div', { class: 'card' },
            h('div', { class: 'alert alert-warning' }, `该试卷已被 ${paper.exam_ref_count} 场考试引用（含已取消），不能编辑。可复制为新试卷后修改。`),
            h('div', { class: 'row' },
              h('a', { class: 'btn', href: `#/teacher/papers/${paper.id}` }, '预览试卷'),
              h('button', { class: 'btn btn-primary', onclick: () => copyPaperFlow(paper) }, '复制为新试卷'))));
        return;
      }
    }

    // ---------- 状态 ----------
    let items = paper ? paper.questions.map((pq) => ({ question_id: pq.question_id, score: pq.score, q: pq, rule: null })) : [];
    let rules = [{ type: 'single', difficulty: '', tags: '', count: 5, score: 2 }];
    let allTags = [];
    api.listTags().then((t) => { allTags = t; }).catch(() => {});

    const normalize = () => { items = items.map((it, i) => [it, i]).sort((a, b) => (TYPE_ORDER[a[0].q.type] - TYPE_ORDER[b[0].q.type]) || (a[1] - b[1])).map((x) => x[0]); };
    normalize();
    const ids = () => items.map((it) => it.question_id).filter((x) => x != null);

    // ---------- 基本信息 ----------
    const titleIn = h('input', { type: 'text', maxlength: 100, placeholder: '如：数据结构期中考试 A 卷', value: paper ? paper.title : '' });
    const descIn = h('textarea', { rows: 2, maxlength: 500, placeholder: '可选' });
    descIn.value = paper ? paper.description || '' : '';

    // ---------- 已选题目 ----------
    const selectedEl = h('div');
    const summaryEl = h('div', { class: 'row small' });
    function renderSelected() {
      clear(selectedEl);
      const total = round1(items.reduce((s, it) => s + (Number(it.score) || 0), 0));
      const byType = TYPES.map((t) => {
        const list = items.filter((it) => it.q.type === t);
        return { t, count: list.length, score: round1(list.reduce((s, it) => s + (Number(it.score) || 0), 0)) };
      }).filter((x) => x.count);
      mount(summaryEl, 
        h('span', null, '题量 ', h('strong', String(items.length))),
        h('span', null, '总分 ', h('strong', { class: 'text-success' }, fmtScore(total))),
        ...byType.map((x) => h('span', { class: 'chip' }, `${TYPE_SHORT[x.t]} ${x.count} 题 / ${fmtScore(x.score)} 分`)));
      if (!items.length) { append(selectedEl, h('div', { class: 'state' }, '尚未选择题目，请在右侧“手动选题”或“随机抽题”中添加')); return; }
      let seq = 0;
      for (const t of TYPES) {
        const group = items.filter((it) => it.q.type === t);
        if (!group.length) continue;
        append(selectedEl, h('div', { class: 'pq-group-title' }, h('span', TYPE_LABEL[t]), h('span', { class: 'muted small' }, `${group.length} 题`)));
        group.forEach((it, gi) => {
          seq += 1;
          const idx = items.indexOf(it);
          const scoreIn = h('input', { type: 'number', class: 'pq-score', min: 0.1, max: 100, step: 0.1, value: String(it.score), 'aria-label': '分值' });
          scoreIn.addEventListener('change', () => { it.score = scoreIn.value === '' ? null : Number(scoreIn.value); renderSelected(); });
          append(selectedEl, h('div', { class: 'pq-row', dataset: { field: `items[${idx}]` } },
            h('span', { class: 'pq-seq' }, String(seq)),
            h('span', { class: 'pq-stem', title: it.q.stem },
              h('button', { class: 'link-btn', type: 'button', onclick: () => previewQuestionDialog({ ...it.q, id: it.question_id ?? it.q.id }) }, truncate(it.q.stem, 60)),
              ' ', h('span', { class: 'muted small' }, DIFF_LABEL[it.q.difficulty] || ''),
              it.question_id == null ? badge('源题已删除', 'danger') : null),
            scoreIn,
            h('span', { class: 'pq-ops' },
              h('button', { class: 'btn btn-sm', type: 'button', title: '上移', disabled: gi === 0, onclick: () => move(idx, -1) }, '↑'),
              h('button', { class: 'btn btn-sm', type: 'button', title: '下移', disabled: gi === group.length - 1, onclick: () => move(idx, 1) }, '↓'),
              h('button', { class: 'btn btn-sm', type: 'button', title: '随机替换为同条件的另一题', onclick: (e) => replace(it, e.currentTarget) }, '换'),
              h('button', { class: 'btn btn-sm', type: 'button', title: '移除', onclick: () => { items.splice(items.indexOf(it), 1); renderSelected(); refreshPicker(); } }, '×')),
            h('div', { class: 'error', hidden: true })));
        });
      }
    }
    function move(idx, d) {
      const j = idx + d;
      if (j < 0 || j >= items.length || items[j].q.type !== items[idx].q.type) return;
      [items[idx], items[j]] = [items[j], items[idx]];
      renderSelected();
    }
    async function replace(it, btn) {
      const cond = it.rule || { type: it.q.type, difficulty: it.q.difficulty, tags: [] };
      btn.disabled = true;
      try {
        const nq = await api.replaceRandomQuestion({ type: cond.type, difficulty: cond.difficulty || null, tags: cond.tags || [], exclude_question_ids: ids() });
        it.question_id = nq.id; it.q = nq;
        toast('已替换', 'success');
        renderSelected(); refreshPicker();
      } catch (e) {
        toast(e.code === 42200 ? `没有可替换的同条件题目（${TYPE_SHORT[cond.type]}${cond.difficulty ? '·' + DIFF_LABEL[cond.difficulty] : ''}）` : e.message, 'error', 4000);
      } finally { btn.disabled = false; }
    }
    function addQuestion(q) {
      if (ids().includes(q.id)) return;
      items.push({ question_id: q.id, score: q.score, q, rule: null });
      normalize();
      renderSelected();
    }

    // ---------- 手动选题 ----------
    const pick = { type: '', difficulty: '', keyword: '', tags: '', page: 1 };
    const pType = selectEl([{ value: '', label: '全部题型' }, ...options(TYPE_LABEL)], '');
    const pDiff = selectEl([{ value: '', label: '全部难度' }, ...options(DIFF_LABEL)], '');
    const pKw = h('input', { type: 'search', placeholder: '题干关键字', maxlength: 50 });
    const pTag = h('input', { type: 'text', placeholder: '标签（逗号分隔）', maxlength: 100 });
    const pickList = h('div');
    const doPick = () => { Object.assign(pick, { type: pType.value, difficulty: pDiff.value, keyword: pKw.value.trim(), tags: parseTags(pTag.value).join(','), page: 1 }); refreshPicker(); };
    [pType, pDiff].forEach((s) => s.addEventListener('change', doPick));
    [pKw, pTag].forEach((s) => s.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPick(); }));
    function refreshPicker() {
      return loadInto(pickList, () => api.listQuestions({ ...pick, page_size: 10, exclude_ids: ids().join(',') }), (data) => {
        const addAll = h('button', { class: 'btn btn-sm', disabled: !data.items.length, onclick: () => { data.items.forEach(addQuestion); refreshPicker(); } }, '本页全部加入');
        return [
          renderTable([
            { title: '题型', className: 'nowrap', render: (x) => TYPE_SHORT[x.type] },
            { title: '题干', render: (x) => h('button', { class: 'link-btn', title: x.stem, onclick: () => previewQuestionDialog(x) }, truncate(x.stem, 36)) },
            { title: '难度', className: 'nowrap', render: (x) => DIFF_LABEL[x.difficulty] },
            { title: '分值', className: 'num', render: (x) => fmtScore(x.score) },
            { title: '', className: 'nowrap', render: (x) => h('button', { class: 'btn btn-sm btn-primary', onclick: () => { addQuestion(x); refreshPicker(); } }, '加入') },
          ], data.items, { empty: '没有可选题目（已选题目不再显示）' }),
          h('div', { class: 'row between mt' }, addAll, renderPagination(data, (p) => { pick.page = p; refreshPicker(); })),
        ];
      });
    }

    // ---------- 随机抽题 ----------
    const rulesEl = h('div');
    function renderRules() {
      clear(rulesEl);
      append(rulesEl, h('div', { class: 'rule-row rule-head' }, h('span', '题型'), h('span', '难度'), h('span', '知识点（可选）'), h('span', '数量'), h('span', '每题分值'), h('span', '')));
      rules.forEach((r, i) => {
        const t = selectEl(options(TYPE_LABEL), r.type); t.onchange = () => { r.type = t.value; };
        const d = selectEl([{ value: '', label: '不限难度' }, ...options(DIFF_LABEL)], r.difficulty); d.onchange = () => { r.difficulty = d.value; };
        const tg = h('input', { type: 'text', value: r.tags, placeholder: '逗号分隔，命中任一', list: 'rule-tags' }); tg.oninput = () => { r.tags = tg.value; };
        const c = h('input', { type: 'number', min: 1, max: 100, step: 1, value: String(r.count) }); c.oninput = () => { r.count = Number(c.value); };
        const s = h('input', { type: 'number', min: 0.1, max: 100, step: 0.1, value: String(r.score) }); s.oninput = () => { r.score = Number(s.value); };
        append(rulesEl, h('div', { class: 'rule-row', dataset: { field: `rules[${i}]` } }, t, d, tg, c, s,
          h('button', { class: 'btn btn-sm', type: 'button', disabled: rules.length <= 1, onclick: () => { rules.splice(i, 1); renderRules(); } }, '删除')));
      });
      append(rulesEl, h('datalist', { id: 'rule-tags' }, allTags.map((x) => h('option', { value: x.name }))));
      const total = round1(rules.reduce((sum, r) => sum + (Number(r.count) || 0) * (Number(r.score) || 0), 0));
      append(rulesEl, h('div', { class: 'row between mt' },
        h('button', { class: 'btn btn-sm', type: 'button', disabled: rules.length >= 20, onclick: () => { rules.push({ type: 'single', difficulty: '', tags: '', count: 1, score: 2 }); renderRules(); } }, '+ 添加规则'),
        h('span', { class: 'muted' }, `预计 ${rules.reduce((s2, r) => s2 + (Number(r.count) || 0), 0)} 题，总分 ${fmtScore(total)}`)));
    }
    const genBtn = h('button', { class: 'btn btn-primary' }, '随机生成');
    genBtn.addEventListener('click', async () => {
      for (const [i, r] of rules.entries()) {
        if (!Number.isInteger(r.count) || r.count < 1 || r.count > 100) { toast(`第 ${i + 1} 条规则：数量须为 1~100 的整数`, 'error'); return; }
        if (!validScore(r.score)) { toast(`第 ${i + 1} 条规则：每题分值须为正数且最多 1 位小数`, 'error'); return; }
      }
      if (items.length && !(await confirm('随机生成', '随机生成的题目将替换当前已选的全部题目，是否继续？'))) return;
      const body = { rules: rules.map((r) => ({ type: r.type, count: r.count, score: r.score, difficulty: r.difficulty || null, tags: parseTags(r.tags) })) };
      genBtn.disabled = true; genBtn.textContent = '生成中…';
      try {
        const draft = await api.generateRandomPaper(body);
        items = draft.items.map((d) => ({ question_id: d.question.id, score: d.score, q: d.question, rule: body.rules[d.rule_index] || null }));
        normalize(); renderSelected(); refreshPicker();
        toast(`已随机抽取 ${items.length} 题，总分 ${fmtScore(draft.total_score)}，可继续调整后保存`, 'success', 4000);
      } catch (e) {
        if (e.code === 42200 && e.data && Array.isArray(e.data.shortages)) {
          const msg = e.data.shortages.map((s) => `规则 ${s.rule_index + 1}：${TYPE_LABEL[s.type] || s.type}${s.difficulty ? `（难度：${DIFF_LABEL[s.difficulty] || s.difficulty}）` : ''}${s.tags && s.tags.length ? `（知识点：${s.tags.join('、')}）` : ''}仅有 ${s.available} 道，需 ${s.required} 道`).join('\n');
          toast(msg || e.message, 'error', 6000);
        } else applyApiError(e, rulesEl);
      } finally { genBtn.disabled = false; genBtn.textContent = '随机生成'; }
    });

    // ---------- 工具面板（标签页） ----------
    const manualPanel = h('div', null, h('div', { class: 'filters' }, pType, pDiff, pKw, pTag, h('button', { class: 'btn', onclick: doPick }, '筛选')), pickList);
    const randomPanel = h('div', null, h('div', { class: 'alert alert-info small' }, '按规则从本人题库中无放回随机抽题，各规则之间不会抽到重复题目；题量不足时整体失败并提示。'), rulesEl, h('div', { class: 'form-actions mt' }, genBtn));
    const tabManual = h('button', { class: 'active', type: 'button' }, '手动选题');
    const tabRandom = h('button', { type: 'button' }, '随机抽题');
    const switchTab = (m) => { tabManual.classList.toggle('active', m === 'manual'); tabRandom.classList.toggle('active', m === 'random'); manualPanel.hidden = m !== 'manual'; randomPanel.hidden = m !== 'random'; };
    tabManual.onclick = () => switchTab('manual');
    tabRandom.onclick = () => switchTab('random');
    switchTab(editing ? 'manual' : 'random');

    // ---------- 保存 ----------
    const formRoot = h('div');
    const saveBtn = h('button', { class: 'btn btn-primary btn-lg' }, '保存试卷');
    saveBtn.addEventListener('click', async () => {
      clearFieldErrors(formRoot);
      const errs = [];
      const title = titleIn.value.trim();
      if (!title) errs.push({ field: 'title', message: '请输入试卷名称' });
      if (!items.length) { toast('试卷至少包含 1 道题', 'error'); if (!errs.length) return; }
      items.forEach((it, i) => {
        if (!validScore(it.score)) errs.push({ field: `items[${i}].score`, message: '分值须为 0~100 的正数，最多 1 位小数' });
        if (it.question_id == null) errs.push({ field: `items[${i}].question_id`, message: '源题目已删除，请移除或替换该题' });
      });
      if (errs.length) { showFieldErrors(formRoot, errs); toast('请检查标红的内容', 'error'); return; }
      const body = { title, description: descIn.value.trim(), items: items.map((it) => ({ question_id: it.question_id, score: it.score })) };
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      try {
        const saved = editing ? await api.updatePaper(params.id, body) : await api.createPaper(body);
        toast('试卷已保存', 'success');
        navigate(`#/teacher/papers/${saved.id}`);
      } catch (e) {
        applyApiError(e, formRoot);
      } finally { saveBtn.disabled = false; saveBtn.textContent = '保存试卷'; }
    });

    append(formRoot, 
      h('div', { class: 'card' }, h('div', { class: 'form-row' },
        field('试卷名称', titleIn, { name: 'title', required: true }),
        field('说明', descIn, { name: 'description' }))),
      h('div', { class: 'paper-layout' },
        h('div', { class: 'card', dataset: { field: 'items' } },
          h('div', { class: 'card-head' }, h('h3', '已选题目'), summaryEl),
          h('div', { class: 'muted small mb' }, '保存时按 单选→多选→判断→填空→简答 分组排序，组内顺序可用 ↑↓ 调整。'),
          h('div', { class: 'error', hidden: true }),
          selectedEl),
        h('div', { class: 'card' }, h('div', { class: 'tabs' }, tabManual, tabRandom), manualPanel, randomPanel)),
      h('div', { class: 'sticky-actions' }, h('a', { class: 'btn btn-lg', href: '#/teacher/papers' }, '取消'), saveBtn));

    append(container, 
      pageHead(editing ? `编辑试卷 - ${paper.title}` : '新建试卷', [], [{ label: '试卷管理', href: '#/teacher/papers' }, { label: editing ? '编辑试卷' : '新建试卷' }]),
      formRoot);
    renderSelected();
    renderRules();
    refreshPicker();
  },
};
