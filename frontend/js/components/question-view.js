// 题目渲染：preview（教师预览）/ answer（学生作答）/ review（答卷回顾）
// 所有题干、选项、答案均以文本节点渲染（XSS 防护）；填空题按 ___ 分割后插入 <input>
import { h, badge } from '../utils/dom.js';
import { TYPE_LABEL, DIFF_LABEL, fmtAnswer, fmtScore } from '../utils/format.js';

const BLANK = '___';
const JUDGE_OPTIONS = [{ key: true, text: '正确' }, { key: false, text: '错误' }];

/** 判断作答是否“已答” */
export function isAnswered(type, r) {
  if (r == null) return false;
  if (type === 'multiple') return Array.isArray(r) && r.length > 0;
  if (type === 'fill') return Array.isArray(r) && r.some((s) => String(s ?? '').trim() !== '');
  if (type === 'essay' || type === 'single') return String(r).trim() !== '';
  if (type === 'judge') return r === true || r === false;
  return true;
}

function splitStem(stem) { return String(stem ?? '').split(BLANK); }

function stemStatic(q) {
  if (q.type !== 'fill') return h('div', { class: 'question-stem' }, q.stem);
  const parts = splitStem(q.stem);
  const nodes = [];
  parts.forEach((p, i) => {
    nodes.push(p);
    if (i < parts.length - 1) nodes.push(h('span', { class: 'blank' }, `（${i + 1}）`));
  });
  return h('div', { class: 'question-stem' }, nodes);
}

function header(q, opts) {
  return h('div', { class: 'question-head' },
    h('span', { class: 'q-no' }, `${opts.number ?? q.seq ?? ''}.`),
    badge(TYPE_LABEL[q.type] || q.type, 'primary'),
    q.difficulty && opts.mode !== 'answer' ? badge(DIFF_LABEL[q.difficulty] || q.difficulty) : null,
    h('span', { class: 'q-score' }, `（${fmtScore(q.score)} 分）`),
    (q.tags || []).length && opts.mode === 'preview' ? h('span', null, q.tags.map((t) => h('span', { class: 'tag' }, t))) : null,
    h('span', { class: 'spacer' }),
    opts.headExtra || null);
}

function includesKey(val, key) {
  if (val == null) return false;
  if (Array.isArray(val)) return val.includes(key);
  return val === key;
}

// ---------------- 作答模式 ----------------
function answerBody(q, opts) {
  const onChange = opts.onChange || (() => {});
  const name = `q-${q.id}`;
  let response = opts.response ?? null;

  if (q.type === 'single' || q.type === 'multiple' || q.type === 'judge') {
    const multiple = q.type === 'multiple';
    const list = q.type === 'judge' ? JUDGE_OPTIONS : (q.options || []);
    const labels = [];
    const sync = () => labels.forEach((l) => l.classList.toggle('selected', l.querySelector('input').checked));
    const box = h('div', { class: ['options', q.type === 'judge' && 'judge-options'] }, list.map((o) => {
      const input = h('input', { type: multiple ? 'checkbox' : 'radio', name, value: String(o.key), checked: includesKey(response, o.key) });
      input.addEventListener('change', () => {
        if (multiple) {
          const vals = labels.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value).sort();
          response = vals.length ? vals : null;
        } else {
          response = o.key;
        }
        sync();
        onChange(response, 'choice');
      });
      const label = h('label', { class: 'option' }, input,
        q.type === 'judge' ? null : h('span', { class: 'opt-key' }, `${o.key}.`),
        h('span', { class: 'opt-text' }, o.text));
      labels.push(label);
      return label;
    }));
    sync();
    return [h('div', { class: 'question-stem' }, q.stem), box];
  }

  if (q.type === 'fill') {
    const parts = splitStem(q.stem);
    const n = Math.max(q.blank_count || 0, parts.length - 1, 1);
    const values = Array.from({ length: n }, (_, i) => (Array.isArray(response) ? response[i] ?? '' : ''));
    const inputs = [];
    const emit = () => {
      const arr = inputs.map((i) => i.value);
      response = arr.some((s) => s.trim() !== '') ? arr : null;
      onChange(response, 'text');
    };
    const mk = (i) => {
      const inp = h('input', { type: 'text', class: 'blank-input', maxlength: 200, placeholder: `第${i + 1}空`, 'aria-label': `第${i + 1}空` });
      inp.value = values[i];
      inp.addEventListener('input', emit);
      inputs.push(inp);
      return inp;
    };
    const nodes = [];
    parts.forEach((p, i) => { nodes.push(p); if (i < parts.length - 1) nodes.push(mk(i)); });
    for (let i = parts.length - 1; i < n; i++) nodes.push(mk(i)); // 题干空位不足时补齐
    return [h('div', { class: 'question-stem' }, nodes)];
  }

  // essay
  const ta = h('textarea', { rows: 6, maxlength: 2000, placeholder: '请输入你的答案（最多 2000 字）' });
  ta.value = typeof response === 'string' ? response : '';
  const counter = h('div', { class: 'char-count' }, `${ta.value.length} / 2000`);
  ta.addEventListener('input', () => {
    counter.textContent = `${ta.value.length} / 2000`;
    response = ta.value.trim() === '' ? null : ta.value;
    onChange(response, 'text');
  });
  return [h('div', { class: 'question-stem' }, q.stem), ta, counter];
}

// ---------------- 预览 / 回顾 ----------------
function staticOptions(q, chosen, correct, { showCorrect, showChosen }) {
  const list = q.type === 'judge' ? JUDGE_OPTIONS : (q.options || []);
  return h('div', { class: ['options', q.type === 'judge' && 'judge-options'] }, list.map((o) => {
    const isCorrect = showCorrect && includesKey(correct, o.key);
    const isChosen = showChosen && includesKey(chosen, o.key);
    const cls = ['option', 'static', isCorrect && 'correct', isChosen && !isCorrect && (showCorrect && correct != null ? 'wrong' : 'selected')];
    const marks = [];
    if (isChosen) marks.push('你的选择');
    if (isCorrect) marks.push('正确答案');
    return h('div', { class: cls },
      q.type === 'judge' ? null : h('span', { class: 'opt-key' }, `${o.key}.`),
      h('span', { class: 'opt-text' }, o.text),
      marks.length ? h('span', { class: ['opt-mark', isCorrect ? 'text-success' : 'text-danger'] }, marks.join(' · ')) : null);
  }));
}

function abRow(label, value, cls) {
  return h('div', { class: 'ab-row' }, h('span', { class: 'ab-label' }, label), h('span', { class: ['pre', cls] }, value));
}

function previewBody(q, opts) {
  const nodes = [stemStatic(q)];
  if (['single', 'multiple', 'judge'].includes(q.type)) nodes.push(staticOptions(q, null, q.answer, { showCorrect: opts.showAnswer, showChosen: false }));
  if (opts.showAnswer) {
    nodes.push(h('div', { class: 'answer-box' },
      abRow(q.type === 'essay' ? '参考答案：' : '标准答案：', q.answer == null ? '（无）' : fmtAnswer(q.type, q.answer), 'text-success'),
      abRow('解析：', q.analysis || '（无）')));
  }
  return nodes;
}

function reviewBody(q, opts) {
  const nodes = [stemStatic(q)];
  const objective = ['single', 'multiple', 'judge'].includes(q.type);
  const hasCorrect = q.correct_answer !== undefined;
  if (objective) nodes.push(staticOptions(q, q.response, q.correct_answer, { showCorrect: hasCorrect && q.correct_answer != null, showChosen: true }));
  let verdict;
  if (q.type === 'essay') verdict = q.got_score == null ? badge('待批改', 'warning') : badge('已批改', 'primary');
  else verdict = q.is_correct ? badge('正确', 'success') : (q.got_score > 0 ? badge('部分正确', 'warning') : badge('错误', 'danger'));
  const box = h('div', { class: 'answer-box' });
  if (q.type === 'essay') {
    box.appendChild(h('div', { class: 'ab-row' }, h('span', { class: 'ab-label' }, '作答：')));
    box.appendChild(h('div', { class: 'response-box' }, q.response == null || q.response === '' ? '未作答' : q.response));
  } else {
    box.appendChild(abRow('作答：', fmtAnswer(q.type, q.response), q.is_correct ? 'text-success' : 'text-danger'));
  }
  if (hasCorrect && q.correct_answer != null) box.appendChild(abRow(q.type === 'essay' ? '参考答案：' : '正确答案：', fmtAnswer(q.type, q.correct_answer), 'text-success'));
  box.appendChild(h('div', { class: 'ab-row' }, h('span', { class: 'ab-label' }, '得分：'),
    h('strong', null, `${fmtScore(q.got_score)} / ${fmtScore(q.score)}`), ' ', verdict));
  if (q.comment) box.appendChild(abRow('评语：', q.comment));
  if (q.analysis) box.appendChild(abRow('解析：', q.analysis));
  nodes.push(box);
  if (opts.extra) nodes.push(opts.extra);
  return nodes;
}

/**
 * @param q 题目（PaperQuestion / StudentQuestion / ReviewQuestion）
 * @param mode 'preview' | 'answer' | 'review'
 * @param opts { response, onChange(response, kind), showAnswer, number, headExtra, extra, id }
 */
export function renderQuestion(q, mode = 'preview', opts = {}) {
  const o = { ...opts, mode };
  const body = mode === 'answer' ? answerBody(q, o) : mode === 'review' ? reviewBody(q, o) : previewBody(q, o);
  return h('div', { class: 'question', id: opts.id || null, dataset: { qid: q.id } }, header(q, o), body);
}
