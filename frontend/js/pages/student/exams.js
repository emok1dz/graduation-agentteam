// 学生首页：我的考试卡片（状态筛选、未开始倒计时）（FR-EXAM-03）
import { h, pageHead, loading, errorState, badge, emptyState, append, mount } from '../../utils/dom.js';
import { fmtRange, fmtDuration, fmtScore, STUDENT_STATUS_LABEL, STUDENT_STATUS_KIND } from '../../utils/format.js';
import * as api from '../../api.js';
import { setQuery, reload } from '../../router.js';

const TABS = [['all', '全部'], ['not_started', '未开始'], ['available', '可参加'], ['finished', '已完成'], ['missed', '已错过']];
let timer = null;

export default {
  async render(container, params, query) {
    const status = query.status || 'all';
    const tabs = h('div', { class: 'tabs' }, TABS.map(([v, l]) => h('button', { type: 'button', class: v === status ? 'active' : null, onclick: () => setQuery({ status: v }) }, l)));
    const listEl = h('div', null, loading());
    append(container, pageHead('我的考试', [h('button', { class: 'btn', onclick: () => reload() }, '刷新')]), tabs, listEl);

    let data;
    try { data = await api.listStudentExams({ status }); } catch (e) { mount(listEl, errorState(e, () => reload())); return; }
    const offset = Date.parse(data.server_time) - Date.now();
    const now = () => Date.now() + offset;
    if (!data.items.length) { mount(listEl, emptyState(status === 'all' ? '暂时没有考试安排' : '该分类下没有考试')); return; }

    const countdowns = [];
    const cards = data.items.map((e) => {
      let action;
      const st = e.student_status;
      if (st === 'not_started') {
        const cd = h('span', { class: 'text-warning small' });
        countdowns.push({ el: cd, at: Date.parse(e.start_time) });
        action = h('div', { class: 'row' }, cd, h('button', { class: 'btn btn-sm', disabled: true }, '未开始'));
      } else if (st === 'available') {
        action = h('a', { class: 'btn btn-primary btn-sm', href: `#/student/exams/${e.id}` }, '开始作答');
      } else if (st === 'in_progress') {
        action = h('a', { class: 'btn btn-primary btn-sm', href: `#/student/exams/${e.id}/take` }, '继续作答');
      } else if (st === 'finished') {
        action = e.results_published ? h('a', { class: 'btn btn-success btn-sm', href: `#/student/results/${e.id}` }, '查看成绩') : h('span', { class: 'muted small' }, '已交卷，等待成绩发布');
      } else {
        action = h('span', { class: 'text-danger small' }, '已错过（记 0 分）');
      }
      return h('div', { class: ['exam-card', `st-${st}`] },
        h('div', { class: 'row between' }, h('h3', e.title), badge(STUDENT_STATUS_LABEL[st] || st, STUDENT_STATUS_KIND[st])),
        h('div', { class: 'meta' }, `时间：${fmtRange(e.start_time, e.end_time)}`),
        h('div', { class: 'meta' }, `时长 ${e.duration_minutes} 分钟 · ${e.question_count} 题 · 满分 ${fmtScore(e.total_score)} · 及格 ${fmtScore(e.pass_score)}`),
        e.description ? h('div', { class: 'meta muted pre' }, e.description.length > 80 ? e.description.slice(0, 80) + '…' : e.description) : null,
        h('div', { class: 'foot' }, h('a', { class: 'small', href: `#/student/exams/${e.id}` }, '考试须知'), action));
    });
    mount(listEl, h('div', { class: 'exam-cards' }, cards));

    clearInterval(timer);
    if (countdowns.length) {
      const tick = () => {
        let reached = false;
        for (const c of countdowns) {
          const ms = c.at - now();
          if (ms <= 0) reached = true;
          c.el.textContent = `距开考 ${fmtDuration(ms)}`;
        }
        if (reached) { clearInterval(timer); timer = null; setTimeout(() => reload(), 1500); }
      };
      tick();
      timer = setInterval(tick, 1000);
    }
  },
  unmount() { clearInterval(timer); timer = null; },
};
