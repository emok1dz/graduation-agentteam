// 批改：按学生逐份 / 按题目逐题，“保存并下一份”；发布/撤回成绩（FR-GRADE-02/03）
import { h, pageHead, loading, errorState, badge, loadInto, clear, append, mount } from '../../utils/dom.js';
import { fmtDateTime, fmtScore, SUB_STATUS_LABEL, SUB_STATUS_KIND, EXAM_STATUS_LABEL, EXAM_STATUS_KIND, SUBMIT_TYPE_LABEL } from '../../utils/format.js';
import { renderQuestion } from '../../components/question-view.js';
import { openModal, confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';

function scoreOk(v, max) { return v != null && !Number.isNaN(v) && v >= 0 && v <= max && Math.abs(Math.round(v * 10) - v * 10) < 1e-9; }

function gradeInputs(max, score, comment, disabled) {
  const s = h('input', { type: 'number', min: 0, max, step: 0.1, value: score == null ? '' : String(score), placeholder: `0 ~ ${max}`, disabled });
  const c = h('input', { type: 'text', maxlength: 500, value: comment || '', placeholder: '评语（可选）', disabled });
  return { s, c, el: h('div', { class: 'grade-box' },
    h('div', { class: 'field' }, h('label', null, `得分（满分 ${fmtScore(max)}）`), s),
    h('div', { class: 'field grow' }, h('label', null, '评语'), c)) };
}

export default {
  async render(container, params) {
    const examId = params.id;
    append(container, loading());
    let exam; let ov;
    try { [exam, ov] = await Promise.all([api.getExam(examId), api.getGradingOverview(examId)]); } catch (e) { mount(container, errorState(e)); return; }
    container.replaceChildren();

    const head = h('div');
    const progressEl = h('div', { class: 'card' });
    const bodyEl = h('div');
    let mode = 'student';
    let currentSid = null;
    let currentPq = null;

    function drawHead() {
      const actions = [h('a', { class: 'btn', href: `#/exams/${exam.id}/scores` }, '成绩统计')];
      if (ov.results_published) actions.push(h('button', { class: 'btn btn-danger', onclick: unpublish }, '撤回发布'));
      else actions.push(h('button', { class: 'btn btn-success', onclick: publish }, '发布成绩'));
      mount(head, pageHead(`阅卷 - ${exam.title}`, actions, [{ label: '考试管理', href: '#/teacher/exams' }, { label: '阅卷' }]));
      const p = ov.progress || { total: 0, graded: 0, pending: 0 };
      const bar = h('div'); bar.style.width = `${p.total ? Math.round((p.graded / p.total) * 100) : 0}%`;
      mount(progressEl, 
        h('div', { class: 'row between mb' },
          h('div', { class: 'row' }, badge(EXAM_STATUS_LABEL[exam.status], EXAM_STATUS_KIND[exam.status]),
            ov.results_published ? badge('成绩已发布', 'success') : badge('成绩未发布', 'muted'),
            h('span', { class: 'muted small' }, `截止 ${fmtDateTime(exam.end_time)}`)),
          h('div', null, '批改进度：', h('strong', `${p.graded} / ${p.total}`), p.pending ? h('span', { class: 'text-warning' }, `（待批改 ${p.pending} 份）`) : null)),
        h('div', { class: 'progress' }, bar),
        ov.results_published ? h('div', { class: 'alert alert-info mt' }, '成绩已发布，如需修改分数请先“撤回发布”。') : null,
        exam.status !== 'ended' ? h('div', { class: 'muted small mt' }, '考试结束后且全部答卷批改完成，才能发布成绩。') : null);
    }

    async function refreshOverview() {
      try { ov = await api.getGradingOverview(examId); drawHead(); } catch (e) { toast(e.message, 'error'); }
    }

    async function publish() {
      const allow = h('input', { type: 'checkbox', checked: true });
      const ok = h('button', { class: 'btn btn-success' }, '确认发布');
      const cancel = h('button', { class: 'btn' }, '取消');
      const m = openModal({ title: '发布成绩', body: h('div', null, h('p', '发布后学生即可查看本场考试成绩。'), h('label', { class: 'check' }, allow, '允许学生查看答案与解析（答卷回顾）')), footer: [cancel, ok] });
      cancel.onclick = () => m.close();
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          const e2 = await api.publishResults(examId, { allow_review: allow.checked });
          exam = e2 || exam; m.close(); toast('成绩已发布', 'success'); await refreshOverview(); drawBody();
        } catch (e) {
          if (e.code === 40907) toast(`尚有 ${e.data?.pending_count ?? ''} 份答卷未完成批改，无法发布`, 'error', 4000);
          else if (e.code === 40902) toast('考试尚未结束，结束后才能发布成绩', 'error', 4000);
          else toast(e.message, 'error');
          ok.disabled = false;
        }
      };
    }
    async function unpublish() {
      if (!(await confirm('撤回发布', '撤回后学生将看不到成绩，您可以修改分数后重新发布。确定撤回吗？', { danger: true }))) return;
      try { const e2 = await api.unpublishResults(examId); exam = e2 || exam; toast('已撤回发布', 'success'); await refreshOverview(); drawBody(); } catch (e) { toast(e.message, 'error'); }
    }

    const tabStudent = h('button', { type: 'button' }, '按学生逐份');
    const tabQuestion = h('button', { type: 'button' }, '按题目逐题');
    tabStudent.onclick = () => { mode = 'student'; drawBody(); };
    tabQuestion.onclick = () => { mode = 'question'; drawBody(); };

    function drawBody() {
      tabStudent.classList.toggle('active', mode === 'student');
      tabQuestion.classList.toggle('active', mode === 'question');
      clear(bodyEl);
      if (!ov.submissions.length) { append(bodyEl, h('div', { class: 'card' }, h('div', { class: 'state' }, '暂无已交卷的答卷'))); return; }
      if (!ov.essay_questions.length) append(bodyEl, h('div', { class: 'alert alert-info' }, '本试卷没有简答题，客观题已在交卷时自动批改，可直接查看答卷或发布成绩。'));
      if (mode === 'student') drawStudentMode(); else drawQuestionMode();
    }

    // ---------- 按学生逐份 ----------
    function drawStudentMode() {
      const listEl = h('div', { class: 'sub-list' });
      const detailEl = h('div');
      const subs = ov.submissions;
      for (const s of subs) {
        const item = h('div', { class: ['sub-item', s.submission_id === currentSid && 'active'], onclick: () => { currentSid = s.submission_id; drawBody(); } },
          h('div', null, h('div', null, `${s.student.name}`), h('div', { class: 'muted small' }, `${s.student.username} · ${s.student.class_name || ''}`)),
          h('div', { class: 'small' }, badge(SUB_STATUS_LABEL[s.status] || s.status, SUB_STATUS_KIND[s.status]),
            s.essay_total ? h('div', { class: 'muted' }, `简答 ${s.essay_graded}/${s.essay_total}`) : null));
        append(listEl, item);
      }
      if (!currentSid || !subs.some((s) => s.submission_id === currentSid)) {
        const first = subs.find((s) => s.status === 'pending_review') || subs[0];
        currentSid = first.submission_id;
        listEl.querySelectorAll('.sub-item')[subs.indexOf(first)].classList.add('active');
      }
      append(bodyEl, h('div', { class: 'grading-layout' }, h('div', { class: 'card' }, h('h3', `答卷（${subs.length}）`), listEl), detailEl));
      loadSubmission(detailEl, currentSid);
    }

    function nextPendingSid(after) {
      const subs = ov.submissions;
      const i = subs.findIndex((s) => s.submission_id === after);
      const ordered = [...subs.slice(i + 1), ...subs.slice(0, i + 1)];
      const n = ordered.find((s) => s.status === 'pending_review' && s.submission_id !== after);
      return n ? n.submission_id : null;
    }

    function loadSubmission(el, sid) {
      return loadInto(el, () => api.getSubmission(sid), (d) => {
        const sub = d.submission;
        const locked = ov.results_published;
        const essays = d.questions.filter((q) => q.type === 'essay');
        const objectives = d.questions.filter((q) => q.type !== 'essay');
        const inputs = [];
        const essayNodes = essays.map((q) => {
          const g = gradeInputs(q.score, q.got_score, q.comment, locked);
          inputs.push({ q, ...g });
          return renderQuestion(q, 'review', { extra: g.el });
        });
        const objBox = h('div', { hidden: true }, objectives.map((q) => renderQuestion(q, 'review')));
        const objToggle = h('button', { class: 'btn btn-sm' }, `显示客观题（${objectives.length}）`);
        objToggle.onclick = () => { objBox.hidden = !objBox.hidden; objToggle.textContent = objBox.hidden ? `显示客观题（${objectives.length}）` : '隐藏客观题'; };
        const saveBtn = h('button', { class: 'btn btn-primary', disabled: locked || !essays.length }, '保存');
        const saveNextBtn = h('button', { class: 'btn btn-success', disabled: locked || !essays.length }, '保存并下一份');
        const save = async (goNext) => {
          const grades = [];
          for (const it of inputs) {
            if (it.s.value === '') continue;
            const v = Number(it.s.value);
            if (!scoreOk(v, it.q.score)) { toast(`第 ${it.q.seq} 题得分须在 0 ~ ${it.q.score} 之间，最多 1 位小数`, 'error'); it.s.focus(); return; }
            grades.push({ paper_question_id: it.q.id, score: v, comment: it.c.value.trim() || null });
          }
          if (!grades.length) { toast('请至少为一道简答题打分', 'warning'); return; }
          saveBtn.disabled = true; saveNextBtn.disabled = true;
          try {
            const r = await api.gradeSubmission(sid, { grades });
            toast(r.status === 'graded' ? `已完成批改，总分 ${fmtScore(r.total_score)}` : `已保存（简答 ${r.essay_graded}/${r.essay_total}）`, 'success');
            await refreshOverview();
            if (goNext) {
              const n = nextPendingSid(sid);
              if (n) currentSid = n; else toast('所有答卷均已批改完成', 'success');
            }
            drawBody();
          } catch (e) { toast(e.message, 'error'); saveBtn.disabled = false; saveNextBtn.disabled = false; }
        };
        saveBtn.onclick = () => save(false);
        saveNextBtn.onclick = () => save(true);
        return h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', `${d.student.name}（${d.student.username}）`),
            badge(SUB_STATUS_LABEL[sub.status] || sub.status, SUB_STATUS_KIND[sub.status]),
            h('a', { class: 'btn btn-sm', href: `#/submissions/${sid}` }, '完整答卷')),
          h('div', { class: 'row small muted mb' },
            h('span', `${d.student.class_name || ''}`),
            h('span', `交卷：${fmtDateTime(sub.submitted_at, true)}（${SUBMIT_TYPE_LABEL[sub.submit_type] || sub.submit_type || '—'}）`),
            h('span', `客观题 ${fmtScore(sub.objective_score)} 分`),
            h('span', `主观题 ${fmtScore(sub.subjective_score)} 分`),
            h('strong', `总分 ${fmtScore(sub.total_score)}`)),
          essays.length ? essayNodes : h('div', { class: 'muted mb' }, '本答卷没有简答题'),
          h('div', { class: 'row between mt' }, objToggle, h('div', { class: 'row' }, saveBtn, saveNextBtn)),
          objBox);
      });
    }

    // ---------- 按题目逐题 ----------
    function drawQuestionMode() {
      if (!ov.essay_questions.length) { append(bodyEl, h('div', { class: 'card' }, h('div', { class: 'state' }, '没有需要人工批改的简答题'))); return; }
      if (!currentPq || !ov.essay_questions.some((q) => q.paper_question_id === currentPq)) currentPq = ov.essay_questions[0].paper_question_id;
      const chips = h('div', { class: 'chips mb' }, ov.essay_questions.map((q) => h('button', {
        class: ['chip', q.paper_question_id === currentPq && 'active'], type: 'button',
        onclick: () => { currentPq = q.paper_question_id; drawBody(); },
      }, `第 ${q.seq} 题（${q.graded_count}/${q.total_count}）`)));
      const detail = h('div');
      append(bodyEl, h('div', { class: 'card' }, chips, detail));
      loadInto(detail, () => api.getGradingByQuestion(examId, currentPq), (d) => {
        const q = d.question;
        const locked = ov.results_published;
        const rows = d.items.map((it, idx) => {
          const g = gradeInputs(q.score, it.score, it.comment, locked);
          const btn = h('button', { class: 'btn btn-primary btn-sm', disabled: locked }, idx < d.items.length - 1 ? '保存并下一条' : '保存');
          const status = h('span', { class: 'small' }, it.score == null ? badge('未批改', 'warning') : badge(`已批 ${fmtScore(it.score)} 分`, 'success'));
          const card = h('div', { class: 'question' },
            h('div', { class: 'question-head' }, h('strong', `${it.student.name}（${it.student.username}）`), h('span', { class: 'spacer' }), status),
            h('div', { class: 'response-box' }, it.response == null || it.response === '' ? '（未作答）' : it.response),
            g.el, h('div', { class: 'form-actions mt' }, btn));
          btn.onclick = async () => {
            if (g.s.value === '') { toast('请输入得分', 'warning'); g.s.focus(); return; }
            const v = Number(g.s.value);
            if (!scoreOk(v, q.score)) { toast(`得分须在 0 ~ ${q.score} 之间，最多 1 位小数`, 'error'); g.s.focus(); return; }
            btn.disabled = true;
            try {
              await api.gradeSubmission(it.submission_id, { grades: [{ paper_question_id: q.paper_question_id, score: v, comment: g.c.value.trim() || null }] });
              it.score = v;
              mount(status, badge(`已批 ${fmtScore(v)} 分`, 'success'));
              toast('已保存', 'success', 1500);
              const next = rows[idx + 1];
              if (next) { next.card.scrollIntoView({ behavior: 'smooth', block: 'center' }); next.input.focus({ preventScroll: true }); }
              refreshOverview();
            } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = locked; }
          };
          return { card, input: g.s };
        });
        return [
          h('div', { class: 'question' },
            h('div', { class: 'question-head' }, h('span', { class: 'q-no' }, `第 ${q.seq} 题`), badge('简答题', 'primary'), h('span', { class: 'q-score' }, `（${fmtScore(q.score)} 分）`)),
            h('div', { class: 'question-stem' }, q.stem),
            h('div', { class: 'answer-box' },
              h('div', { class: 'ab-row' }, h('span', { class: 'ab-label' }, '参考答案：'), h('span', { class: 'pre' }, q.reference_answer || '（无）')),
              q.analysis ? h('div', { class: 'ab-row' }, h('span', { class: 'ab-label' }, '解析：'), h('span', { class: 'pre' }, q.analysis)) : null)),
          h('h3', { class: 'mt' }, `学生作答（${d.items.length}）`),
          rows.length ? rows.map((r) => r.card) : h('div', { class: 'state' }, '暂无作答'),
        ];
      });
    }

    append(container, head, progressEl, h('div', { class: 'tabs' }, tabStudent, tabQuestion), bodyEl);
    drawHead();
    drawBody();
  },
};
