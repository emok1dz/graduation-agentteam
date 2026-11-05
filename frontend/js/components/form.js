// 表单字段生成与字段级错误显示（映射 ApiError.data.errors[].field）
import { h, qsa } from '../utils/dom.js';
import { toast } from './modal.js';

/**
 * fields: [{ name, label, type, options:[{value,label}], required, placeholder, hint, attrs, visibleWhen(values), render(value) }]
 * type: text | password | number | textarea | select | datetime-local | checkbox | checkboxes | custom
 * 返回 { el, getValues, setErrors, clearErrors, isVisible, inputs }
 */
export function buildForm(fields, initial = {}) {
  const inputs = {};
  const wrappers = {};
  const customGetters = {};
  const el = h('div', { class: 'form' });

  for (const f of fields) {
    const val = initial[f.name];
    let input;
    switch (f.type) {
      case 'select':
        input = h('select', { name: f.name, ...(f.attrs || {}) },
          (f.options || []).map((o) => h('option', { value: String(o.value ?? '') }, o.label)));
        if (val != null && (f.options || []).some((o) => String(o.value ?? '') === String(val))) input.value = String(val);
        break;
      case 'textarea':
        input = h('textarea', { name: f.name, placeholder: f.placeholder || '', rows: f.rows || 4, ...(f.attrs || {}) });
        input.value = val ?? '';
        break;
      case 'checkbox':
        input = h('input', { type: 'checkbox', name: f.name, checked: !!val, ...(f.attrs || {}) });
        break;
      case 'checkboxes': {
        const set = new Set((val || []).map(String));
        input = h('div', { class: ['check-list', f.column && 'col'] },
          (f.options || []).length ? f.options.map((o) => h('label', { class: 'check' },
            h('input', { type: 'checkbox', value: String(o.value), checked: set.has(String(o.value)) }), o.label))
            : h('span', { class: 'muted' }, f.emptyText || '无可选项'));
        break;
      }
      case 'custom': {
        const r = f.render(val);
        input = r.el;
        customGetters[f.name] = r.getValue;
        break;
      }
      default:
        input = h('input', { type: f.type || 'text', name: f.name, placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off', ...(f.attrs || {}) });
        input.value = val ?? '';
    }
    inputs[f.name] = input;
    const label = f.type === 'checkbox'
      ? h('label', { class: 'check' }, input, f.label)
      : h('label', null, f.label, f.required ? h('span', { class: 'req' }, '*') : null);
    const wrap = h('div', { class: 'field', dataset: { field: f.name } },
      label,
      f.type === 'checkbox' ? null : input,
      f.hint ? h('div', { class: 'hint' }, f.hint) : null,
      h('div', { class: 'error', hidden: true }));
    wrappers[f.name] = wrap;
    el.appendChild(wrap);
  }

  function readValue(f) {
    const input = inputs[f.name];
    if (customGetters[f.name]) return customGetters[f.name]();
    if (f.type === 'checkbox') return input.checked;
    if (f.type === 'checkboxes') return qsa('input[type=checkbox]', input).filter((c) => c.checked).map((c) => (f.numeric === false ? c.value : Number(c.value)));
    const v = input.value;
    if (f.type === 'number') return v === '' ? null : Number(v);
    if (f.type === 'select' && f.numeric) return v === '' ? null : Number(v);
    return f.trim === false ? v : v.trim();
  }

  function getValues() {
    const out = {};
    for (const f of fields) out[f.name] = readValue(f);
    return out;
  }

  function refreshVisibility() {
    const values = getValues();
    for (const f of fields) if (f.visibleWhen) wrappers[f.name].hidden = !f.visibleWhen(values);
  }
  if (fields.some((f) => f.visibleWhen)) {
    el.addEventListener('change', refreshVisibility);
    el.addEventListener('input', refreshVisibility);
    refreshVisibility();
  }

  return {
    el,
    inputs,
    getValues,
    isVisible: (name) => !wrappers[name] || !wrappers[name].hidden,
    setErrors: (errors) => showFieldErrors(el, errors),
    clearErrors: () => clearFieldErrors(el),
  };
}

/** 在 root 内查找 data-field 匹配的容器：精确 → 逐级去掉末尾 .x / [n] */
function findFieldEl(root, field) {
  let f = String(field || '');
  while (f) {
    const el = root.querySelector(`[data-field="${CSS.escape(f)}"]`);
    if (el) return el;
    const m = /^(.*)(\.[^.[\]]+|\[\d+\])$/.exec(f);
    if (!m) break;
    f = m[1];
  }
  return null;
}

/** 显示字段错误，返回未能定位的错误列表 */
export function showFieldErrors(root, errors = []) {
  const unmatched = [];
  for (const e of errors) {
    const wrap = findFieldEl(root, e.field);
    if (!wrap) { unmatched.push(e); continue; }
    wrap.classList.add('has-error');
    let errEl = wrap.querySelector(':scope > .error');
    if (!errEl) { errEl = h('div', { class: 'error' }); wrap.appendChild(errEl); }
    errEl.hidden = false;
    errEl.textContent = errEl.textContent && !errEl.textContent.includes(e.message) ? `${errEl.textContent}；${e.message}` : e.message;
  }
  const first = root.querySelector('.has-error');
  if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
  return unmatched;
}

export function clearFieldErrors(root) {
  for (const w of qsa('.has-error', root)) w.classList.remove('has-error');
  for (const e of qsa('.field > .error, [data-field] > .error', root)) { e.textContent = ''; e.hidden = true; }
}

/** 统一处理接口错误：40000 → 字段错误；其他 → toast */
export function applyApiError(err, formOrRoot) {
  const root = formOrRoot && formOrRoot.el ? formOrRoot.el : formOrRoot;
  if (err && err.code === 40000 && err.data && Array.isArray(err.data.errors) && root) {
    const unmatched = showFieldErrors(root, err.data.errors);
    const msg = unmatched.length ? unmatched.map((e) => `${e.field}: ${e.message}`).join('；') : (err.message || '参数校验失败');
    toast(msg, 'error', 4000);
  } else {
    toast((err && err.message) || '操作失败', 'error', 4000);
  }
}

/** 单个字段容器（页面内表单使用） */
export function field(label, input, { name, hint, required } = {}) {
  return h('div', { class: 'field', dataset: name ? { field: name } : undefined },
    label ? h('label', null, label, required ? h('span', { class: 'req' }, '*') : null) : null,
    input,
    hint ? h('div', { class: 'hint' }, hint) : null,
    h('div', { class: 'error', hidden: true }));
}

export function selectEl(opts, value, attrs = {}) {
  const el = h('select', attrs, opts.map((o) => h('option', { value: String(o.value ?? '') }, o.label)));
  if (value != null && opts.some((o) => String(o.value ?? '') === String(value))) el.value = String(value);
  return el;
}
