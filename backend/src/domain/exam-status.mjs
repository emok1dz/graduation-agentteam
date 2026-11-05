// 考试状态（计算得出，不存储）与学生视角状态
export const GRACE_MS = 10 * 1000;

export function examStatus(exam, now) {
  const t = now instanceof Date ? now.getTime() : now;
  if (exam.cancelled_at) return 'cancelled';
  if (t < Date.parse(exam.start_time)) return 'not_started';
  if (t <= Date.parse(exam.end_time)) return 'ongoing';
  return 'ended';
}

export function computeDeadline(startedAtMs, exam) {
  return new Date(Math.min(startedAtMs + exam.duration_minutes * 60000, Date.parse(exam.end_time))).toISOString();
}

export function isExpired(submission, now, graceMs = GRACE_MS) {
  const t = now instanceof Date ? now.getTime() : now;
  return submission.status === 'in_progress' && !!submission.deadline_at && t > Date.parse(submission.deadline_at) + graceMs;
}

/** not_started / available / in_progress / finished / missed */
export function studentExamStatus(exam, submission, now) {
  const t = now instanceof Date ? now.getTime() : now;
  if (submission) {
    if (submission.submit_type === 'absent') return 'missed';
    if (submission.status === 'in_progress') return 'in_progress';
    return 'finished';
  }
  if (t < Date.parse(exam.start_time)) return 'not_started';
  if (t <= Date.parse(exam.end_time)) return 'available';
  return 'missed';
}
