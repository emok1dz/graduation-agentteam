// 登录页：登录成功后按角色跳转首页（或 redirect 参数指定的页面）
import { h } from '../utils/dom.js';
import { fmtDateTime } from '../utils/format.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { navigate, match } from '../router.js';

const DEMO = [
  ['admin', 'admin123', '管理员'],
  ['teacher1', 'teacher123', '教师'],
  ['student1', 'student123', '学生'],
];

export default {
  render(container, params, query) {
    const username = h('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: '请输入账号', maxlength: 20 });
    const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: '请输入密码', maxlength: 64 });
    const errBox = h('div', { class: 'alert alert-danger', hidden: true });
    const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, '登 录');

    const showError = (msg) => { errBox.textContent = msg; errBox.hidden = false; };

    const form = h('form', { class: 'form', novalidate: true },
      errBox,
      h('div', { class: 'field' }, h('label', { for: 'login-username' }, '账号'), username),
      h('div', { class: 'field' }, h('label', { for: 'login-password' }, '密码'), password),
      submit);
    username.id = 'login-username';
    password.id = 'login-password';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const u = username.value.trim();
      const p = password.value;
      if (!u) { showError('请输入账号'); username.focus(); return; }
      if (!p) { showError('请输入密码'); password.focus(); return; }
      submit.disabled = true;
      submit.textContent = '登录中…';
      try {
        const data = await api.login({ username: u, password: p });
        store.setAuth(data.token, data.user);
        let target = store.homeOf(data.user.role);
        const redirect = query.redirect;
        if (redirect && redirect.startsWith('/') && !redirect.startsWith('/login')) {
          const m = match(redirect.split('?')[0]);
          if (m && m.route.roles && m.route.roles.includes(data.user.role)) target = '#' + redirect;
        }
        navigate(target, { replace: true });
      } catch (err) {
        if (err.code === 42900 && err.data && err.data.locked_until) {
          showError(`${err.message}（解锁时间：${fmtDateTime(err.data.locked_until)}）`);
        } else {
          showError(err.message || '登录失败');
        }
        password.select();
      } finally {
        submit.disabled = false;
        submit.textContent = '登 录';
      }
    });

    const demo = h('div', { class: 'demo' }, '演示账号：',
      DEMO.map(([u, p, label]) => h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { username.value = u; password.value = p; },
      }, label)));

    container.appendChild(h('div', { class: 'login-page' },
      h('div', { class: 'login-box' },
        h('h1', '在线考试系统'),
        h('div', { class: 'sub' }, '管理员 · 教师 · 学生 统一登录'),
        form,
        demo)));
    setTimeout(() => username.focus(), 0);
  },
};
