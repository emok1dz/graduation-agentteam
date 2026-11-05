// 接口封装：request() + 62 个具名函数（与 design/api-contract.yaml 的 operationId 同名）
// 约定：响应 {code, message, data}；code===0 返回 data，否则抛 ApiError；40100 清除登录态并跳转登录页。

import * as store from './store.js';

export class ApiError extends Error {
  constructor(code, message, data = null, http = 0) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.code = code;
    this.data = data;
    this.http = http;
  }
}

/** 网络层错误码（非业务码） */
export const NETWORK_ERROR = -1;

function buildQuery(query) {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    sp.append(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}

const id = (v) => encodeURIComponent(String(v));

function handleUnauthenticated() {
  store.clearAuth();
  const hash = location.hash || '';
  if (!hash.startsWith('#/login')) {
    const back = hash.replace(/^#/, '');
    location.hash = '#/login' + (back && back !== '/' ? '?redirect=' + encodeURIComponent(back) : '');
  }
}

export async function request(method, path, { query, body, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  const token = store.getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path + buildQuery(query), init);
  } catch (e) {
    throw new ApiError(NETWORK_ERROR, '网络连接失败，请检查网络后重试', null, 0);
  }
  const ctype = res.headers.get('content-type') || '';
  if (raw && res.ok && !ctype.includes('application/json')) {
    const blob = await res.blob();
    blob.filename = parseFilename(res.headers.get('content-disposition'));
    return blob;
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError(res.status >= 500 ? 50000 : NETWORK_ERROR, `服务器响应异常（HTTP ${res.status}）`, null, res.status);
  }
  if (payload && payload.code === 0) return payload.data;
  const code = payload && typeof payload.code === 'number' ? payload.code : res.status * 100;
  if (code === 40100) handleUnauthenticated();
  throw new ApiError(code, (payload && payload.message) || `请求失败（HTTP ${res.status}）`, payload ? payload.data : null, res.status);
}

function parseFilename(cd) {
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1].replace(/"/g, '')); } catch { /* ignore */ } }
  const m2 = /filename="?([^";]+)"?/i.exec(cd);
  return m2 ? m2[1] : null;
}

/** 循环拉取分页接口的全部数据（用于下拉选项等） */
export async function fetchAll(fn, query = {}, ...pre) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await fn(...pre, { ...query, page, page_size: 100 });
    all.push(...data.items);
    if (all.length >= data.total || data.items.length === 0 || page >= 50) break;
    page += 1;
  }
  return all;
}

// ===================== AUTH (4) =====================
export const login = (body) => request('POST', '/auth/login', { body });
export const logout = () => request('POST', '/auth/logout');
export const getMe = () => request('GET', '/auth/me');
export const changePassword = (body) => request('PUT', '/auth/password', { body });

// ===================== USERS (6) =====================
export const listUsers = (query) => request('GET', '/users', { query });
export const createUser = (body) => request('POST', '/users', { body });
export const getUser = (uid) => request('GET', `/users/${id(uid)}`);
export const updateUser = (uid, body) => request('PUT', `/users/${id(uid)}`, { body });
export const deleteUser = (uid) => request('DELETE', `/users/${id(uid)}`);
export const resetUserPassword = (uid) => request('POST', `/users/${id(uid)}/reset-password`);

// ===================== CLASSES (9) =====================
export const listClasses = (query) => request('GET', '/classes', { query });
export const createClass = (body) => request('POST', '/classes', { body });
export const getClass = (cid) => request('GET', `/classes/${id(cid)}`);
export const updateClass = (cid, body) => request('PUT', `/classes/${id(cid)}`, { body });
export const deleteClass = (cid) => request('DELETE', `/classes/${id(cid)}`);
export const getClassMembers = (cid) => request('GET', `/classes/${id(cid)}/members`);
export const addClassStudents = (cid, body) => request('POST', `/classes/${id(cid)}/students`, { body });
export const removeClassStudents = (cid, body) => request('POST', `/classes/${id(cid)}/students/remove`, { body });
export const setClassTeachers = (cid, body) => request('PUT', `/classes/${id(cid)}/teachers`, { body });

// ===================== TAGS (4) =====================
export const listTags = () => request('GET', '/tags');
export const createTag = (body) => request('POST', '/tags', { body });
export const renameTag = (tid, body) => request('PUT', `/tags/${id(tid)}`, { body });
export const deleteTag = (tid) => request('DELETE', `/tags/${id(tid)}`);

// ===================== QUESTIONS (6) =====================
export const listQuestions = (query) => request('GET', '/questions', { query });
export const createQuestion = (body) => request('POST', '/questions', { body });
export const importQuestions = (body) => request('POST', '/questions/import', { body });
export const getQuestion = (qid) => request('GET', `/questions/${id(qid)}`);
export const updateQuestion = (qid, body) => request('PUT', `/questions/${id(qid)}`, { body });
export const deleteQuestion = (qid) => request('DELETE', `/questions/${id(qid)}`);

// ===================== PAPERS (8) =====================
export const listPapers = (query) => request('GET', '/papers', { query });
export const createPaper = (body) => request('POST', '/papers', { body });
export const generateRandomPaper = (body) => request('POST', '/papers/random/generate', { body });
export const replaceRandomQuestion = (body) => request('POST', '/papers/random/replace', { body });
export const getPaper = (pid) => request('GET', `/papers/${id(pid)}`);
export const updatePaper = (pid, body) => request('PUT', `/papers/${id(pid)}`, { body });
export const deletePaper = (pid) => request('DELETE', `/papers/${id(pid)}`);
export const copyPaper = (pid, body = {}) => request('POST', `/papers/${id(pid)}/copy`, { body });

// ===================== EXAMS (6) =====================
export const listExams = (query) => request('GET', '/exams', { query });
export const createExam = (body) => request('POST', '/exams', { body });
export const getExam = (eid) => request('GET', `/exams/${id(eid)}`);
export const updateExam = (eid, body) => request('PUT', `/exams/${id(eid)}`, { body });
export const cancelExam = (eid) => request('POST', `/exams/${id(eid)}/cancel`);
export const getExamMonitor = (eid) => request('GET', `/exams/${id(eid)}/monitor`);

// ===================== STUDENT (5) =====================
export const listStudentExams = (query) => request('GET', '/student/exams', { query });
export const getStudentExam = (eid) => request('GET', `/student/exams/${id(eid)}`);
export const startExam = (eid) => request('POST', `/student/exams/${id(eid)}/start`);
export const listStudentResults = (query) => request('GET', '/student/results', { query });
export const getStudentResult = (examId) => request('GET', `/student/results/${id(examId)}`);

// ===================== SUBMISSIONS (4) =====================
export const getSubmission = (sid) => request('GET', `/submissions/${id(sid)}`);
export const saveAnswers = (sid, body) => request('PUT', `/submissions/${id(sid)}/answers`, { body });
export const submitSubmission = (sid, body = {}) => request('POST', `/submissions/${id(sid)}/submit`, { body });
export const gradeSubmission = (sid, body) => request('PUT', `/submissions/${id(sid)}/grades`, { body });

// ===================== GRADING (4) =====================
export const getGradingOverview = (eid) => request('GET', `/exams/${id(eid)}/grading`);
export const getGradingByQuestion = (eid, pqid) => request('GET', `/exams/${id(eid)}/grading/questions/${id(pqid)}`);
export const publishResults = (eid, body = {}) => request('POST', `/exams/${id(eid)}/publish-results`, { body });
export const unpublishResults = (eid) => request('POST', `/exams/${id(eid)}/unpublish-results`);

// ===================== STATS (5) =====================
export const getScoreSheet = (eid, query) => request('GET', `/exams/${id(eid)}/scores`, { query });
/** 返回 Blob（blob.filename 为服务端建议文件名） */
export const exportScoreSheet = (eid, query) => request('GET', `/exams/${id(eid)}/scores/export`, { query, raw: true });
export const getStatsSummary = (eid, query) => request('GET', `/exams/${id(eid)}/stats/summary`, { query });
export const getStatsDistribution = (eid, query) => request('GET', `/exams/${id(eid)}/stats/distribution`, { query });
export const getStatsQuestions = (eid, query) => request('GET', `/exams/${id(eid)}/stats/questions`, { query });

// ===================== ADMIN (1) =====================
export const getOverview = () => request('GET', '/admin/overview');
