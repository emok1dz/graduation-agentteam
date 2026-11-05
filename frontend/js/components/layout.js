// 布局：顶栏（姓名/角色/修改密码/退出）+ 按角色侧边导航 + 内容区
import { h, clear } from '../utils/dom.js';
import { ROLE_LABEL } from '../utils/format.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { confirm } from './modal.js';

export const NAV = {
  admin: [
    { key: 'admin-overview', label: '系统概览', href: '#/admin/overview' },
    { key: 'admin-users', label: '用户管理', href: '#/admin/users' },
    { key: 'admin-classes', label: '班级管理', href: '#/admin/classes' },
    { key: 'admin-exams', label: '考试总览', href: '#/admin/exams' },
  ],
  teacher: [
    { group: '题库' },
    { key: 'teacher-questions', label: '题库管理', href: '#/teacher/questions' },
    { key: 'teacher-tags', label: '知识点标签', href: '#/teacher/tags' },
    { group: '组卷与考试' },
    { key: 'teacher-papers', label: '试卷管理', href: '#/teacher/papers' },
    { key: 'teacher-exams', label: '考试管理', href: '#/teacher/exams' },
  ],
  student: [
    { key: 'student-exams', label: '我的考试', href: '#/student/exams' },
    { key: 'student-results', label: '我的成绩', href: '#/student/results' },
  ],
};

let shell = null; // { root, userId, nav, content, sidenav }

export async function logoutFlow() {
  const ok = await confirm('退出登录', '确定要退出当前账号吗？');
  if (!ok) return;
  try { await api.logout(); } catch { /* 令牌已失效也视为退出 */ }
  store.clearAuth();
  location.hash = '#/login';
}

/** 渲染（或复用）带导航的外壳，返回内容区容器 */
export function renderLayout(root, user, navKey) {
  if (!shell || shell.root !== root || shell.userId !== user.id || !root.contains(shell.content)) {
    clear(root);
    const sidenav = h('nav', { class: 'sidenav', 'aria-label': '主导航' });
    const toggle = h('button', { class: 'btn btn-sm menu-toggle', type: 'button', 'aria-label': '菜单', onclick: () => sidenav.classList.toggle('open') }, '☰');
    const topbar = h('header', { class: 'topbar' },
      toggle,
      h('a', { class: 'brand', href: store.homeOf(user.role) }, h('span', { class: 'brand-logo' }, '考'), h('span', { class: 'hide-sm' }, '在线考试系统')),
      h('div', { class: 'spacer' }),
      h('span', { class: 'user-info', title: user.username }, `${user.name}（${ROLE_LABEL[user.role] || user.role}）`),
      h('a', { class: 'btn btn-sm btn-ghost', href: '#/profile' }, '修改密码'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: logoutFlow }, '退出'));
    const content = h('main', { class: 'content' });
    root.appendChild(topbar);
    root.appendChild(h('div', { class: 'shell' }, sidenav, content));
    sidenav.addEventListener('click', (e) => { if (e.target.closest('a')) sidenav.classList.remove('open'); });
    for (const item of NAV[user.role] || []) {
      sidenav.appendChild(item.group
        ? h('div', { class: 'nav-group' }, item.group)
        : h('a', { href: item.href, dataset: { key: item.key } }, item.label));
    }
    shell = { root, userId: user.id, content, sidenav };
  }
  for (const a of shell.sidenav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.key === navKey);
  clear(shell.content);
  const page = h('div', { class: 'page' });
  shell.content.appendChild(page);
  window.scrollTo(0, 0);
  return page;
}

/** 无导航的整页（登录页、答题页） */
export function renderBare(root) {
  shell = null;
  clear(root);
  const page = h('div', { class: 'page-bare' });
  root.appendChild(page);
  window.scrollTo(0, 0);
  return page;
}
