// 格式化与枚举中文标签

const pad = (n, l = 2) => String(n).padStart(l, '0');

export function fmtDateTime(iso, withSeconds = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${s}:${pad(d.getSeconds())}` : s;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtRange(start, end) {
  const s = fmtDateTime(start);
  const e = fmtDateTime(end);
  if (s.slice(0, 10) === e.slice(0, 10)) return `${s} ~ ${e.slice(11)}`;
  return `${s} ~ ${e}`;
}

/** 毫秒 → HH:MM:SS（负数视为 0） */
export function fmtCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

/** 毫秒 → “x天x小时x分x秒”（用于开考倒计时） */
export function fmtDuration(ms) {
  let t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400); t %= 86400;
  const hh = Math.floor(t / 3600); t %= 3600;
  const mm = Math.floor(t / 60); const ss = t % 60;
  if (d) return `${d}天${hh}小时${mm}分`;
  if (hh) return `${hh}小时${mm}分${ss}秒`;
  return `${mm}分${ss}秒`;
}

/** ISO → datetime-local 输入值（本地时区） */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 输入值 → ISO（UTC） */
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtScore(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return String(Math.round(Number(n) * 100) / 100);
}

export function fmtPercent(n) {
  if (n == null) return '—';
  return `${Math.round(Number(n) * 10) / 10}%`;
}

export const ROLE_LABEL = { admin: '管理员', teacher: '教师', student: '学生' };
export const USER_STATUS_LABEL = { active: '启用', disabled: '禁用' };
export const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', essay: '简答题' };
export const TYPE_SHORT = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', essay: '简答' };
export const TYPE_ORDER = { single: 1, multiple: 2, judge: 3, fill: 4, essay: 5 };
export const TYPES = ['single', 'multiple', 'judge', 'fill', 'essay'];
export const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '困难' };
export const DIFFS = ['easy', 'medium', 'hard'];
export const EXAM_STATUS_LABEL = { not_started: '未开始', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
export const EXAM_STATUS_KIND = { not_started: 'warning', ongoing: 'primary', ended: 'muted', cancelled: 'danger' };
export const SUB_STATUS_LABEL = { not_started: '未参加', in_progress: '作答中', pending_review: '待批改', graded: '已批改' };
export const SUB_STATUS_KIND = { not_started: 'muted', in_progress: 'primary', pending_review: 'warning', graded: 'success' };
export const SUBMIT_TYPE_LABEL = { manual: '手动交卷', auto: '到时自动交卷', forced: '超时强制交卷', absent: '缺考' };
export const STUDENT_STATUS_LABEL = { not_started: '未开始', available: '可参加', in_progress: '作答中', finished: '已交卷', missed: '已错过' };
export const STUDENT_STATUS_KIND = { not_started: 'warning', available: 'primary', in_progress: 'primary', finished: 'success', missed: 'danger' };
export const MONITOR_STATE_LABEL = { not_started: '未开始', in_progress: '作答中', submitted: '已交卷', absent: '缺考' };
export const MONITOR_STATE_KIND = { not_started: 'muted', in_progress: 'primary', submitted: 'success', absent: 'danger' };

export const options = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** 把 answer / response 转成可读文本 */
export function fmtAnswer(type, value, { correct = false } = {}) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '未作答';
  switch (type) {
    case 'single': return String(value);
    case 'multiple': return Array.isArray(value) ? value.join('、') : String(value);
    case 'judge': return value === true ? '正确' : value === false ? '错误' : String(value);
    case 'fill':
      if (!Array.isArray(value)) return String(value);
      return value.map((v, i) => `(${i + 1}) ${Array.isArray(v) ? v.join(' / ') : (v === '' ? '（空）' : v)}`).join('；');
    case 'essay':
    default:
      return String(value);
  }
}

export function truncate(s, n = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export function round1(n) { return Math.round(Number(n) * 10) / 10; }
