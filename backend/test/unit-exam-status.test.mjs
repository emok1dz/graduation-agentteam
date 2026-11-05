// 单元测试：domain/exam-status（考试状态、截止时刻、超时判定、学生视角状态）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examStatus, computeDeadline, isExpired, studentExamStatus, GRACE_MS } from '../src/domain/exam-status.mjs';

const T = Date.parse('2026-11-05T08:00:00.000Z');
const exam = { start_time: '2026-11-05T08:00:00.000Z', end_time: '2026-11-05T09:00:00.000Z', duration_minutes: 30, cancelled_at: null };

test('UT-EXST-01 examStatus 边界：start 前 not_started，[start,end] ongoing，end 后 ended', () => {
  assert.equal(examStatus(exam, T - 1), 'not_started');
  assert.equal(examStatus(exam, T), 'ongoing');
  assert.equal(examStatus(exam, T + 3600_000), 'ongoing');
  assert.equal(examStatus(exam, T + 3600_001), 'ended');
  assert.equal(examStatus(exam, new Date(T + 10)), 'ongoing', '接受 Date');
  assert.equal(examStatus({ ...exam, cancelled_at: '2026-11-04T00:00:00Z' }, T + 10), 'cancelled');
});

test('UT-EXST-02 computeDeadline = min(started+时长, end_time)', () => {
  assert.equal(computeDeadline(T + 5 * 60_000, exam), '2026-11-05T08:35:00.000Z');
  assert.equal(computeDeadline(T + 50 * 60_000, exam), '2026-11-05T09:00:00.000Z', '晚进入被 end_time 截断');
});

test('UT-EXST-03 isExpired：仅 in_progress 且 now > deadline + 宽限', () => {
  const sub = { status: 'in_progress', deadline_at: '2026-11-05T08:30:00.000Z' };
  const d = Date.parse(sub.deadline_at);
  assert.equal(GRACE_MS, 10_000);
  assert.equal(isExpired(sub, d + GRACE_MS), false);
  assert.equal(isExpired(sub, d + GRACE_MS + 1), true);
  assert.equal(isExpired(sub, new Date(d + 1), 0), true, '自定义宽限');
  assert.equal(isExpired({ ...sub, status: 'graded' }, d + 99_999), false);
  assert.equal(isExpired({ status: 'in_progress', deadline_at: null }, d + 99_999), false);
});

test('UT-EXST-04 studentExamStatus 五种状态', () => {
  assert.equal(studentExamStatus(exam, null, T - 1), 'not_started');
  assert.equal(studentExamStatus(exam, null, T + 1), 'available');
  assert.equal(studentExamStatus(exam, null, T + 3600_001), 'missed');
  assert.equal(studentExamStatus(exam, { status: 'in_progress' }, T + 1), 'in_progress');
  assert.equal(studentExamStatus(exam, { status: 'pending_review', submit_type: 'manual' }, T + 1), 'finished');
  assert.equal(studentExamStatus(exam, { status: 'graded', submit_type: 'absent' }, new Date(T + 3600_001)), 'missed');
});
