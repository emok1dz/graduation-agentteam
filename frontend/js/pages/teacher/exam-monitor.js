// 作答监控（每 15s 刷新）（FR-EXAM-02）
import { h, pageHead, loading, errorState, badge, append, mount } from '../../utils/dom.js';
import { fmtDateTime, fmtRange, fmtTime, EXAM_STATUS_LABEL, EXAM_STATUS_KIND, MONITOR_STATE_LABEL, MONITOR_STATE_KIND, SUBMIT_TYPE_LABEL } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { selectEl } from '../../components/form.js';
import * as api from '../../api.js';

let timer = null;

export default {
  async render(container, params) {
    const examId = params.id;
    const head = h('div');
    const statsEl = h('div', { class: 'stats-grid' });
    const tableEl = h('div', null, loading());
    const info = h('span', { class: 'muted small' });
    const classSel = selectEl([{ value: '', label: '全部班级' }], '');
    const stateSel = selectEl([{ value: '', label: '全部状态' }, ...Object.entries(MONITOR_STATE_LABEL).map(([value, label]) => ({ value, label }))], '');
    const refreshBtn = h('button', { class: 'btn btn-sm', onclick: () => refresh() }, '立即刷新');
    let last = null;
    append(container, head, statsEl, h('div', { class: 'card' }, h('div', { class: 'filters' }, classSel, stateSel, refreshBtn, info), tableEl));
    classSel.onchange = () => draw();
    stateSel.onchange = () => draw();

    try {
      const exam = await api.getExam(examId);
      mount(head, 
        pageHead(`作答监控 - ${exam.title}`, [
          h('a', { class: 'btn', href: `#/teacher/exams/${exam.id}/grading` }, '批改'),
          h('a', { class: 'btn', href: `#/exams/${exam.id}/scores` }, '成绩统计'),
        ], [{ label: '考试管理', href: '#/teacher/exams' }, { label: '作答监控' }]),
        h('div', { class: 'card row' }, badge(EXAM_STATUS_LABEL[exam.status], EXAM_STATUS_KIND[exam.status]),
          h('span', null, fmtRange(exam.start_time, exam.end_time)), h('span', { class: 'muted' }, `时长 ${exam.duration_minutes} 分钟 · ${exam.question_count} 题 / ${exam.total_score} 分`)));
      for (const c of exam.classes || []) append(classSel, h('option', { value: String(c.id) }, c.name));
    } catch (e) {
      mount(head, errorState(e));
    }

    const stat = (label, n, kind) => h('div', { class: ['stat', kind] }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, String(n)));
    function draw() {
      if (!last) return;
      const rows = last.items.filter((r) => (!classSel.value || String(r.class_id) === classSel.value) && (!stateSel.value || r.state === stateSel.value));
      const cnt = (s) => last.items.filter((r) => r.state === s).length;
      mount(statsEl, 
        stat('应考', last.items.length, 'primary'), stat('未开始', cnt('not_started'), ''), stat('作答中', cnt('in_progress'), 'warning'),
        stat('已交卷', cnt('submitted'), 'success'), stat('缺考', cnt('absent'), 'danger'));
      mount(tableEl, renderTable([
        { title: '学号', key: 'username' },
        { title: '姓名', key: 'name' },
        { title: '班级', key: 'class_name' },
        { title: '状态', render: (r) => badge(MONITOR_STATE_LABEL[r.state] || r.state, MONITOR_STATE_KIND[r.state]) },
        { title: '开始时间', className: 'nowrap', render: (r) => fmtDateTime(r.started_at, true) },
        { title: '交卷时间', className: 'nowrap', render: (r) => fmtDateTime(r.submitted_at, true) },
        { title: '交卷方式', render: (r) => (r.submit_type ? SUBMIT_TYPE_LABEL[r.submit_type] || r.submit_type : '—') },
        { title: '', render: (r) => (r.submission_id && r.state === 'submitted' ? h('a', { class: 'link-btn', href: `#/submissions/${r.submission_id}` }, '查看答卷') : '') },
      ], rows, { empty: '暂无学生' }));
    }
    async function refresh() {
      refreshBtn.disabled = true;
      try {
        last = await api.getExamMonitor(examId);
        info.textContent = `更新于 ${fmtTime(last.server_time)}${last.status === 'ongoing' ? '，每 15 秒自动刷新' : ''}`;
        draw();
        if (['ended', 'cancelled'].includes(last.status) && timer) { clearInterval(timer); timer = null; }
      } catch (e) {
        if (!last) mount(tableEl, errorState(e, refresh));
        info.textContent = `刷新失败：${e.message}`;
      } finally { refreshBtn.disabled = false; }
    }
    await refresh();
    clearInterval(timer);
    if (!last || last.status === 'ongoing' || last.status === 'not_started') timer = setInterval(refresh, 15000);
  },
  unmount() { clearInterval(timer); timer = null; },
};
