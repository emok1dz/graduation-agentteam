// 弹窗、确认框、轻提示、表单弹窗
import { h, append } from '../utils/dom.js';
import { buildForm, applyApiError } from './form.js';

export function toast(message, type = 'info', duration = 3000) {
  const root = document.getElementById('toast');
  if (!root) return;
  const el = h('div', { class: ['toast', type], role: 'status' }, message);
  root.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/** 打开通用弹窗：返回 {el, body, foot, close} */
export function openModal({ title, body, footer, wide = false, onClose, closeOnMask = false } = {}) {
  const root = document.getElementById('modal-root') || document.body;
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    mask.remove();
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch { /* ignore */ } }
    if (onClose) onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = h('div', { class: 'modal-foot' }, footer || null);
  const modal = h('div', { class: ['modal', wide && 'wide'], role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h3', title || ''), h('button', { class: 'modal-close', type: 'button', 'aria-label': '关闭', onclick: () => close(undefined) }, '×')),
    bodyEl,
    footer ? footEl : null);
  const mask = h('div', { class: 'modal-mask', onmousedown: (e) => { if (closeOnMask && e.target === mask) close(undefined); } }, modal);
  root.appendChild(mask);
  document.addEventListener('keydown', onKey);
  setTimeout(() => {
    const f = modal.querySelector('input:not([type=hidden]):not([disabled]), textarea, select, .btn-primary');
    if (f) f.focus();
  }, 30);
  return { el: modal, body: bodyEl, foot: footEl, close };
}

/** 确认框 → Promise<boolean> */
export function confirm(title, message, { okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const ok = h('button', { class: ['btn', danger ? 'btn-danger' : 'btn-primary'], type: 'button' }, okText);
    const cancel = h('button', { class: 'btn', type: 'button' }, cancelText);
    const content = message instanceof Node ? message : h('div', { class: 'pre' }, message || '');
    const m = openModal({ title, body: content, footer: [cancel, ok], onClose: (r) => resolve(r === true) });
    ok.addEventListener('click', () => m.close(true));
    cancel.addEventListener('click', () => m.close(false));
    setTimeout(() => ok.focus(), 40);
  });
}

/** 提示框（只有“知道了”按钮） */
export function alertDialog(title, message) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, '知道了');
    const m = openModal({ title, body: message instanceof Node ? message : h('div', { class: 'pre' }, message), footer: [ok], onClose: () => resolve() });
    ok.addEventListener('click', () => m.close(true));
  });
}

/**
 * 表单弹窗：fields 见 form.js；onSubmit(values) 返回 Promise，抛 ApiError 时自动显示字段错误。
 * 返回 Promise<onSubmit 的结果 | null(取消)>
 */
export function formDialog({ title, fields, initial = {}, submitText = '保存', onSubmit, wide = false, intro = null, validate }) {
  return new Promise((resolve) => {
    const form = buildForm(fields, initial);
    let result = null;
    const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, submitText);
    const cancelBtn = h('button', { class: 'btn', type: 'button' }, '取消');
    const formEl = h('form', { class: 'form', novalidate: true }, intro, form.el);
    const m = openModal({ title, body: formEl, footer: [cancelBtn, submitBtn], wide, onClose: () => resolve(result) });
    cancelBtn.addEventListener('click', () => m.close());
    const doSubmit = async (e) => {
      if (e) e.preventDefault();
      if (submitBtn.disabled) return;
      form.clearErrors();
      const values = form.getValues();
      if (validate) {
        const errs = validate(values);
        if (errs && errs.length) { form.setErrors(errs); return; }
      }
      const missing = fields.filter((f) => f.required && form.isVisible(f.name) && (values[f.name] == null || values[f.name] === '' || (Array.isArray(values[f.name]) && !values[f.name].length)));
      if (missing.length) { form.setErrors(missing.map((f) => ({ field: f.name, message: `请填写${f.label}` }))); return; }
      submitBtn.disabled = true;
      const old = submitBtn.textContent;
      submitBtn.textContent = '提交中…';
      try {
        result = (await onSubmit(values)) ?? true;
        m.close();
      } catch (err) {
        applyApiError(err, form);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = old;
      }
    };
    formEl.addEventListener('submit', doSubmit);
    submitBtn.addEventListener('click', doSubmit);
  });
}

export { append };
