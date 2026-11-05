// 修改本人密码（FR-AUTH-03）
import { h, pageHead, append } from '../utils/dom.js';
import { buildForm, applyApiError } from '../components/form.js';
import { toast } from '../components/modal.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { ROLE_LABEL } from '../utils/format.js';

const POLICY = /^(?=.*[A-Za-z])(?=.*\d).{6,32}$/;

export default {
  render(container) {
    const user = store.getUser();
    const form = buildForm([
      { name: 'old_password', label: '原密码', type: 'password', required: true, autocomplete: 'current-password', trim: false },
      { name: 'new_password', label: '新密码', type: 'password', required: true, hint: '6~32 位，须同时包含字母与数字', autocomplete: 'new-password', trim: false },
      { name: 'confirm_password', label: '确认新密码', type: 'password', required: true, autocomplete: 'new-password', trim: false },
    ]);
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, '保存');
    const formEl = h('form', { class: 'form', novalidate: true }, form.el, h('div', { class: 'form-actions' }, btn));
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.clearErrors();
      const v = form.getValues();
      const errs = [];
      if (!v.old_password) errs.push({ field: 'old_password', message: '请输入原密码' });
      if (!POLICY.test(v.new_password || '')) errs.push({ field: 'new_password', message: '新密码须为 6~32 位且同时包含字母与数字' });
      else if (v.new_password === v.old_password) errs.push({ field: 'new_password', message: '新密码不能与原密码相同' });
      if (v.confirm_password !== v.new_password) errs.push({ field: 'confirm_password', message: '两次输入的新密码不一致' });
      if (errs.length) { form.setErrors(errs); return; }
      btn.disabled = true;
      try {
        await api.changePassword(v);
        toast('密码修改成功，其他设备上的登录已失效', 'success');
        formEl.reset();
      } catch (err) {
        if (err.code === 40003) form.setErrors([{ field: 'old_password', message: err.message }]);
        applyApiError(err, form);
      } finally { btn.disabled = false; }
    });
    append(container, 
      pageHead('修改密码'),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'card' }, h('h3', '账号信息'),
          h('dl', { class: 'kv' },
            h('dt', '账号'), h('dd', user.username),
            h('dt', '姓名'), h('dd', user.name),
            h('dt', '角色'), h('dd', ROLE_LABEL[user.role] || user.role),
            user.class_name ? [h('dt', '班级'), h('dd', user.class_name)] : null)),
        h('div', { class: 'card' }, h('h3', '设置新密码'), formEl)));
  },
};
