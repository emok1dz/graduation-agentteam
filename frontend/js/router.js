// hash 路由（设计文档 §5.1）：模式匹配、角色守卫、页面卸载钩子 unmount()
import * as store from './store.js';
import { renderLayout, renderBare } from './components/layout.js';
import { h, errorState, loading } from './utils/dom.js';

const A = ['admin'], T = ['teacher'], S = ['student'], ALL = ['admin', 'teacher', 'student'], TA = ['teacher', 'admin'];

// 字面量路径需排在同层级的 :id 之前
export const ROUTES = [
  { path: '/login', load: () => import('./pages/login.js'), roles: null, bare: true, title: '登录' },
  { path: '/profile', load: () => import('./pages/profile.js'), roles: ALL, title: '修改密码' },

  { path: '/admin/overview', load: () => import('./pages/admin/overview.js'), roles: A, nav: 'admin-overview', title: '系统概览' },
  { path: '/admin/users', load: () => import('./pages/admin/users.js'), roles: A, nav: 'admin-users', title: '用户管理' },
  { path: '/admin/classes', load: () => import('./pages/admin/classes.js'), roles: A, nav: 'admin-classes', title: '班级管理' },
  { path: '/admin/classes/:id', load: () => import('./pages/admin/class-members.js'), roles: A, nav: 'admin-classes', title: '班级成员' },
  { path: '/admin/exams', load: () => import('./pages/admin/exams.js'), roles: A, nav: 'admin-exams', title: '考试总览' },

  { path: '/teacher/questions', load: () => import('./pages/teacher/questions.js'), roles: T, nav: 'teacher-questions', title: '题库管理' },
  { path: '/teacher/questions/new', load: () => import('./pages/teacher/question-edit.js'), roles: T, nav: 'teacher-questions', title: '新增题目' },
  { path: '/teacher/questions/import', load: () => import('./pages/teacher/question-import.js'), roles: T, nav: 'teacher-questions', title: '批量导入' },
  { path: '/teacher/questions/:id/edit', load: () => import('./pages/teacher/question-edit.js'), roles: T, nav: 'teacher-questions', title: '编辑题目' },
  { path: '/teacher/tags', load: () => import('./pages/teacher/tags.js'), roles: T, nav: 'teacher-tags', title: '知识点标签' },
  { path: '/teacher/papers', load: () => import('./pages/teacher/papers.js'), roles: T, nav: 'teacher-papers', title: '试卷管理' },
  { path: '/teacher/papers/new', load: () => import('./pages/teacher/paper-edit.js'), roles: T, nav: 'teacher-papers', title: '新建试卷' },
  { path: '/teacher/papers/:id/edit', load: () => import('./pages/teacher/paper-edit.js'), roles: T, nav: 'teacher-papers', title: '编辑试卷' },
  { path: '/teacher/papers/:id', load: () => import('./pages/teacher/paper-preview.js'), roles: T, nav: 'teacher-papers', title: '试卷预览' },
  { path: '/teacher/exams', load: () => import('./pages/teacher/exams.js'), roles: T, nav: 'teacher-exams', title: '考试管理' },
  { path: '/teacher/exams/new', load: () => import('./pages/teacher/exam-edit.js'), roles: T, nav: 'teacher-exams', title: '发布考试' },
  { path: '/teacher/exams/:id/edit', load: () => import('./pages/teacher/exam-edit.js'), roles: T, nav: 'teacher-exams', title: '修改考试' },
  { path: '/teacher/exams/:id/monitor', load: () => import('./pages/teacher/exam-monitor.js'), roles: T, nav: 'teacher-exams', title: '作答监控' },
  { path: '/teacher/exams/:id/grading', load: () => import('./pages/teacher/grading.js'), roles: T, nav: 'teacher-exams', title: '阅卷' },

  { path: '/exams/:id/scores', load: () => import('./pages/shared/scores.js'), roles: TA, nav: (u) => (u.role === 'admin' ? 'admin-exams' : 'teacher-exams'), title: '成绩与统计' },
  { path: '/submissions/:id', load: () => import('./pages/shared/submission-detail.js'), roles: TA, nav: (u) => (u.role === 'admin' ? 'admin-exams' : 'teacher-exams'), title: '答卷详情' },

  { path: '/student/exams', load: () => import('./pages/student/exams.js'), roles: S, nav: 'student-exams', title: '我的考试' },
  { path: '/student/exams/:id', load: () => import('./pages/student/exam-notice.js'), roles: S, nav: 'student-exams', title: '考试须知' },
  { path: '/student/exams/:id/take', load: () => import('./pages/student/exam-take.js'), roles: S, bare: true, title: '在线答题' },
  { path: '/student/results', load: () => import('./pages/student/results.js'), roles: S, nav: 'student-results', title: '我的成绩' },
  { path: '/student/results/:examId', load: () => import('./pages/student/result-detail.js'), roles: S, nav: 'student-results', title: '成绩详情' },
];

const NOT_FOUND = { path: '*', load: () => import('./pages/not-found.js'), roles: null, title: '页面不存在' };

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}
for (const r of ROUTES) Object.assign(r, compile(r.path));

export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = {};
  if (qi >= 0) for (const [k, v] of new URLSearchParams(raw.slice(qi + 1))) query[k] = v;
  return { path: path || '/', query };
}

export function match(path) {
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : '#' + hash;
  if (replace) {
    history.replaceState(null, '', target);
    handle();
  } else if (location.hash === target) {
    handle(); // 相同地址强制刷新
  } else {
    location.hash = target;
  }
}

/** 更新当前路由的查询参数（列表页筛选/分页） */
export function setQuery(patch, { replace = false } = {}) {
  const { path, query } = parseHash();
  const next = { ...query, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v != null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  navigate('#' + path + (s ? '?' + s : ''), { replace });
}

export function reload() { handle(); }

let current = null; // { mod, container }
let generation = 0;
let appRoot = null;

function unmountCurrent() {
  if (current && current.mod && typeof current.mod.unmount === 'function') {
    try { current.mod.unmount(); } catch (e) { console.error(e); }
  }
  current = null;
}

async function handle() {
  const gen = ++generation;
  const { path, query } = parseHash();
  const user = store.getUser();
  const loggedIn = store.isLoggedIn();

  if (path === '/' || path === '') {
    return navigate(loggedIn ? store.homeOf(user.role) : '#/login', { replace: true });
  }
  const m = match(path);
  let route = m ? m.route : NOT_FOUND;
  const params = m ? m.params : {};

  if (route.roles === null && route.path === '/login' && loggedIn) {
    return navigate(store.homeOf(user.role), { replace: true });
  }
  if (route.roles) {
    if (!loggedIn) {
      return navigate('#/login?redirect=' + encodeURIComponent(location.hash.replace(/^#/, '')), { replace: true });
    }
    if (!route.roles.includes(user.role)) {
      return navigate(store.homeOf(user.role), { replace: true });
    }
  }

  unmountCurrent();
  const bare = route.bare || (route === NOT_FOUND && !loggedIn);
  const navKey = typeof route.nav === 'function' ? route.nav(user) : route.nav;
  const container = bare ? renderBare(appRoot) : renderLayout(appRoot, user, navKey);
  document.title = `${route.title} - 在线考试系统`;
  container.appendChild(loading());

  let mod;
  try {
    mod = (await route.load()).default;
  } catch (e) {
    console.error(e);
    if (gen !== generation) return;
    container.replaceChildren(errorState(new Error('页面加载失败，请刷新重试'), () => handle()));
    return;
  }
  if (gen !== generation) return; // 已切换到其他路由
  container.replaceChildren();
  current = { mod, container };
  try {
    await mod.render(container, params, query);
  } catch (e) {
    console.error(e);
    if (gen === generation && container.isConnected) container.replaceChildren(errorState(e, () => handle()));
  }
}

export function start(root) {
  appRoot = root;
  window.addEventListener('hashchange', handle);
  handle();
}

export const isActive = (container) => !!(container && container.isConnected);
export { h };
