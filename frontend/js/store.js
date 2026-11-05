// 登录态：token 存 localStorage['exam_token']，用户信息缓存在 localStorage['exam_user']

const TOKEN_KEY = 'exam_token';
const USER_KEY = 'exam_user';

let token = null;
let user = null;
const listeners = new Set();

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 隐私模式等 */ } }

function emit() { for (const fn of listeners) { try { fn(user); } catch (e) { console.error(e); } } }

export function restore() {
  token = lsGet(TOKEN_KEY);
  try { user = JSON.parse(lsGet(USER_KEY) || 'null'); } catch { user = null; }
  if (!token) user = null;
}

export function setAuth(t, u) {
  token = t; user = u;
  lsSet(TOKEN_KEY, t);
  lsSet(USER_KEY, JSON.stringify(u));
  emit();
}

export function setUser(u) {
  user = u;
  lsSet(USER_KEY, JSON.stringify(u));
  emit();
}

export function clearAuth() {
  const had = !!token;
  token = null; user = null;
  lsSet(TOKEN_KEY, null);
  lsSet(USER_KEY, null);
  if (had) emit();
}

export const getToken = () => token;
export const getUser = () => user;
export const isLoggedIn = () => !!(token && user);

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const HOME = { admin: '#/admin/overview', teacher: '#/teacher/questions', student: '#/student/exams' };
export function homeOf(role) { return HOME[role] || '#/login'; }

export default { restore, setAuth, setUser, clearAuth, getToken, getUser, isLoggedIn, onChange, homeOf };
