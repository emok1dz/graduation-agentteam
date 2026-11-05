// 成绩单 + 概要统计 + 分数段柱状图 + 每题分析（教师/管理员共用）+ 导出（FR-STAT-02~06）
import { h, pageHead, loading, errorState, badge, append, mount } from '../../utils/dom.js';
import { fmtDateTime, fmtScore, fmtPercent, truncate, TYPE_SHORT, DIFF_LABEL, SUB_STATUS_LABEL, SUB_STATUS_KIND, SUBMIT_TYPE_LABEL, EXAM_STATUS_LABEL, EXAM_STATUS_KIND } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderBarChart } from '../../components/bar-chart.js';
import { selectEl } from '../../components/form.js';
import { toast } from '../../components/modal.js';
import * as api from '../../api.js';
import * as store from '../../store.js';
import { setQuery } from '../../router.js';

const stat = (label, value, kind = '', sub = '') => h('div', { class: ['stat', kind] }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);

function rateBar(rate) {
  if (rate == null) return '—';
  const kind = rate < 60 ? 'low' : rate < 80 ? 'mid' : 'high';
  const fill = h('span'); fill.style.width = `${Math.max(0, Math.min(100, rate))}%`;
  return h('span', { class: 'nowrap' }, h('span', { class: ['rate-bar', kind] }, fill), fmtPercent(rate));
}

export default {
  async render(container, params, query) {
    const examId = params.id;
    const user = store.getUser();
    const classId = query.class_id || '';
    const sort = query.sort || 'total_desc';
    const qsort = query.qsort || 'seq';
    const cq = classId ? { class_id: classId } : {};
    append(container, loading());

    let sheet; let summary; let dist; let qs;
    try {
      [sheet, summary, dist, qs] = await Promise.all([
        api.getScoreSheet(examId, { ...cq, sort }),
        api.getStatsSummary(examId, cq),
        api.getStatsDistribution(examId, cq),
        api.getStatsQuestions(examId, { ...cq, sort: qsort }),
      ]);
    } catch (e) { mount(container, errorState(e, () => setQuery({}))); return; }
    container.replaceChildren();
    const exam = sheet.exam;

    const classSel = selectEl([{ value: '', label: '全部参考班级' }, ...(exam.classes || []).map((c) => ({ value: c.id, label: c.name }))], classId);
    classSel.onchange = () => setQuery({ class_id: classSel.value });
    const exportBtn = h('button', { class: 'btn' }, '导出 CSV');
    exportBtn.onclick = async () => {
      exportBtn.disabled = true;
      try {
        const blob = await api.exportScoreSheet(examId, cq);
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: blob.filename || `${exam.title}-成绩单.csv` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (e) { toast(e.message, 'error'); } finally { exportBtn.disabled = false; }
    };
    const actions = [classSel, exportBtn];
    if (user.role === 'teacher') actions.push(h('a', { class: 'btn btn-primary', href: `#/teacher/exams/${exam.id}/grading` }, '批改 / 发布'));
    const crumbs = user.role === 'admin' ? [{ label: '考试总览', href: '#/admin/exams' }, { label: '成绩与统计' }] : [{ label: '考试管理', href: '#/teacher/exams' }, { label: '成绩与统计' }];

    // ---------- 概要 ----------
    const s = summary;
    const summaryCards = h('div', { class: 'stats-grid' },
      stat('应考人数', String(s.expected_count), 'primary'),
      stat('实考人数', String(s.actual_count)),
      stat('缺考人数', String(s.absent_count), s.absent_count ? 'danger' : ''),
      stat('待批改/作答中', String(s.pending_count), s.pending_count ? 'warning' : ''),
      stat('平均分', fmtScore(s.average_score), 'primary', `满分 ${fmtScore(s.total_score)}`),
      stat('最高分', fmtScore(s.max_score), 'success'),
      stat('最低分', fmtScore(s.min_score), 'danger'),
      stat('及格人数', String(s.pass_count), '', `及格线 ${fmtScore(s.pass_score)}`),
      stat('及格率', fmtPercent(s.pass_rate), s.pass_rate >= 60 ? 'success' : 'warning'));
    const byClass = (s.by_class || []).length > 1 ? h('div', { class: 'card' }, h('h3', '班级对比'), renderTable([
      { title: '班级', key: 'class_name' },
      { title: '应考', className: 'num', render: (r) => String(r.expected_count) },
      { title: '实考', className: 'num', render: (r) => String(r.actual_count) },
      { title: '缺考', className: 'num', render: (r) => String(r.absent_count) },
      { title: '平均分', className: 'num', render: (r) => fmtScore(r.average_score) },
      { title: '最高分', className: 'num', render: (r) => fmtScore(r.max_score) },
      { title: '最低分', className: 'num', render: (r) => fmtScore(r.min_score) },
      { title: '及格人数', className: 'num', render: (r) => String(r.pass_count) },
      { title: '及格率', className: 'num', render: (r) => fmtPercent(r.pass_rate) },
    ], s.by_class)) : null;

    // ---------- 分数段 ----------
    const distCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', '分数段分布'), h('span', { class: 'muted small' }, `实考 ${dist.actual_count} 人，按得分率（满分 ${fmtScore(dist.total_score)}）划分`)),
      dist.actual_count ? h('div', { class: 'grid grid-2' },
        renderBarChart(dist.buckets),
        renderTable([
          { title: '分数段', render: (b) => b.label },
          { title: '分数区间', className: 'nowrap', render: (b) => `${fmtScore(b.min_score)} ~ ${fmtScore(b.max_score)}` },
          { title: '人数', className: 'num', render: (b) => String(b.count) },
          { title: '占比', className: 'num', render: (b) => fmtPercent(b.ratio) },
        ], dist.buckets)) : h('div', { class: 'state' }, '暂无已批改的答卷，无法统计'));

    // ---------- 每题分析 ----------
    const qsortSel = selectEl([{ value: 'seq', label: '按题号' }, { value: 'rate_asc', label: '按得分率升序（难题在前）' }], qsort);
    qsortSel.onchange = () => setQuery({ qsort: qsortSel.value });
    const qCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', '每题正确率分析'), qsortSel),
      renderTable([
        { title: '题号', className: 'nowrap', render: (r) => String(r.seq) },
        { title: '题型', className: 'nowrap', render: (r) => TYPE_SHORT[r.type] || r.type },
        { title: '题干', render: (r) => h('div', { class: 'cell-ellipsis', title: r.stem_summary }, truncate(r.stem_summary, 40)) },
        { title: '难度', className: 'nowrap', render: (r) => DIFF_LABEL[r.difficulty] || r.difficulty || '—' },
        { title: '知识点', render: (r) => ((r.tags || []).length ? h('span', null, r.tags.map((t) => h('span', { class: 'tag' }, t))) : '—') },
        { title: '分值', className: 'num', render: (r) => fmtScore(r.score) },
        { title: '平均得分', className: 'num', render: (r) => fmtScore(r.avg_score) },
        { title: '满分人数', className: 'num', render: (r) => `${r.full_score_count}/${r.attempt_count}` },
        { title: '正确率', render: (r) => (r.type === 'essay' ? h('span', { class: 'muted' }, '—') : rateBar(r.correct_rate)) },
        { title: '得分率', render: (r) => rateBar(r.score_rate) },
        { title: '选项分布', render: (r) => ((r.option_stats || []).length ? h('div', { class: 'chips' }, r.option_stats.map((o) => h('span', { class: ['chip', o.is_correct && 'active'], title: o.is_correct ? '正确选项' : '' }, `${o.key}: ${o.count}（${fmtPercent(o.ratio)}）`))) : '—') },
      ], qs.items, { empty: '暂无数据' }));

    // ---------- 成绩单 ----------
    const sortSel = selectEl([{ value: 'total_desc', label: '按总分降序' }, { value: 'username_asc', label: '按学号升序' }], sort);
    sortSel.onchange = () => setQuery({ sort: sortSel.value });
    const sheetCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', `成绩单（${sheet.items.length} 人）`), sortSel),
      renderTable([
        { title: '排名', className: 'num', render: (r) => (r.rank == null ? '—' : String(r.rank)) },
        { title: '学号', key: 'username' },
        { title: '姓名', key: 'name' },
        { title: '班级', key: 'class_name' },
        { title: '状态', render: (r) => (r.submit_type === 'absent' ? badge('缺考', 'danger') : badge(SUB_STATUS_LABEL[r.status] || r.status, SUB_STATUS_KIND[r.status])) },
        { title: '交卷方式', className: 'nowrap', render: (r) => (r.submit_type ? SUBMIT_TYPE_LABEL[r.submit_type] || r.submit_type : '—') },
        { title: '交卷时间', className: 'nowrap', render: (r) => fmtDateTime(r.submitted_at) },
        { title: '客观分', className: 'num', render: (r) => fmtScore(r.objective_score) },
        { title: '主观分', className: 'num', render: (r) => fmtScore(r.subjective_score) },
        { title: '总分', className: 'num', render: (r) => h('strong', fmtScore(r.total_score)) },
        { title: '及格', render: (r) => (r.passed == null ? '—' : r.passed ? badge('及格', 'success') : badge('不及格', 'danger')) },
        { title: '', className: 'nowrap', render: (r) => (r.submission_id && r.status !== 'in_progress' && r.submit_type !== 'absent' ? h('a', { class: 'link-btn', href: `#/submissions/${r.submission_id}` }, '答卷') : '') },
      ], sheet.items, { empty: '参考班级暂无学生' }));

    append(container, 
      pageHead(`成绩与统计 - ${exam.title}`, actions, crumbs),
      h('div', { class: 'card row' },
        badge(EXAM_STATUS_LABEL[exam.status] || exam.status, EXAM_STATUS_KIND[exam.status]),
        exam.results_published ? badge('成绩已发布', 'success') : badge('成绩未发布', 'muted'),
        h('span', { class: 'muted' }, `满分 ${fmtScore(exam.total_score)} · 及格线 ${fmtScore(exam.pass_score)} · 参考班级：${(exam.classes || []).map((c) => c.name).join('、')}`)),
      summaryCards, byClass, distCard, qCard, sheetCard);
  },
};
