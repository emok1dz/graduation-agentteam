// 考试须知 + 开始/继续作答按钮
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtDateTime, fmtDuration, fmtScore, STUDENT_STATUS_LABEL, STUDENT_STATUS_KIND } from '../../utils/format.js';
import * as api from '../../api.js';
import { navigate, reload } from '../../router.js';

let timer = null;

export default {
  async render(container, params) {
    const body = h('div');
    append(container, body);
    await loadInto(body, () => api.getStudentExam(params.id), (e) => {
      const st = e.student_status;
      const offset = e.server_time ? Date.parse(e.server_time) - Date.now() : 0;
      const agree = h('input', { type: 'checkbox' });
      const startBtn = h('button', { class: 'btn btn-primary btn-lg', disabled: true }, st === 'in_progress' ? '继续作答' : '开始作答');
      agree.onchange = () => { startBtn.disabled = !agree.checked; };
      startBtn.onclick = () => navigate(`#/student/exams/${e.id}/take`);
      let action;
      if (st === 'available' || st === 'in_progress') {
        action = h('div', null, h('label', { class: 'check mb' }, agree, '我已阅读并同意遵守以上考试须知'), h('div', { class: 'mt' }, startBtn));
      } else if (st === 'not_started') {
        const cd = h('strong', { class: 'text-warning' });
        const tick = () => {
          const ms = Date.parse(e.start_time) - (Date.now() + offset);
          cd.textContent = fmtDuration(ms);
          if (ms <= 0) { clearInterval(timer); timer = null; setTimeout(() => reload(), 1200); }
        };
        tick(); clearInterval(timer); timer = setInterval(tick, 1000);
        action = h('div', { class: 'alert alert-warning' }, '考试尚未开始，距开考还有 ', cd);
      } else if (st === 'finished') {
        action = h('div', { class: 'alert alert-success' }, '您已交卷。', e.results_published ? h('a', { href: `#/student/results/${e.id}` }, '查看成绩') : '成绩发布后可在“我的成绩”中查看。');
      } else {
        action = h('div', { class: 'alert alert-danger' }, '考试已结束，您未参加本场考试（记 0 分）。');
      }
      return [
        pageHead(e.title, [h('a', { class: 'btn', href: '#/student/exams' }, '返回考试列表')], [{ label: '我的考试', href: '#/student/exams' }, { label: '考试须知' }]),
        h('div', { class: 'grid grid-2' },
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', '考试信息'), badge(STUDENT_STATUS_LABEL[st] || st, STUDENT_STATUS_KIND[st])),
            h('dl', { class: 'kv' },
              h('dt', '开始时间'), h('dd', fmtDateTime(e.start_time)),
              h('dt', '结束时间'), h('dd', fmtDateTime(e.end_time)),
              h('dt', '考试时长'), h('dd', `${e.duration_minutes} 分钟`),
              h('dt', '题量'), h('dd', `${e.question_count} 题`),
              h('dt', '满分 / 及格'), h('dd', `${fmtScore(e.total_score)} / ${fmtScore(e.pass_score)}`)),
            e.description ? h('div', { class: 'mt' }, h('h4', '考试说明'), h('div', { class: 'pre' }, e.description)) : null),
          h('div', { class: 'card' }, h('h3', '考试须知'),
            h('ol', null,
              h('li', '作答时间以服务器时间为准：开始作答后开始计时，截止时刻 = min(开始时刻 + 考试时长, 考试结束时间)，中途离开不会暂停计时。'),
              h('li', '答案会自动保存（选择题即时保存，文字输入停止 2 秒后保存，另每 30 秒兜底保存）。'),
              h('li', '刷新页面、关闭浏览器或短暂断网后可重新进入继续作答，已保存的答案不会丢失。'),
              h('li', '倒计时结束时系统将自动交卷；交卷后不可再修改答案。'),
              h('li', '请独立完成考试，遵守考试纪律。')),
            action)),
      ];
    });
  },
  unmount() { clearInterval(timer); timer = null; },
};
