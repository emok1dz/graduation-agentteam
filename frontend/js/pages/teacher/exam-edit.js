// 发布 / 修改考试（FR-EXAM-01/02）：未开始可改全部字段；进行中仅可延长结束时间
import { h, pageHead, loading, errorState, append, mount } from '../../utils/dom.js';
import { toLocalInput, fromLocalInput, fmtScore, EXAM_STATUS_LABEL, round1 } from '../../utils/format.js';
import { field, selectEl, showFieldErrors, clearFieldErrors, applyApiError } from '../../components/form.js';
import { toast } from '../../components/modal.js';
import * as api from '../../api.js';
import { navigate } from '../../router.js';

export default {
  async render(container, params, query) {
    const editing = !!params.id;
    append(container, loading());
    let exam = null; let papers = []; let classes = [];
    try {
      [exam, papers, classes] = await Promise.all([
        editing ? api.getExam(params.id) : null,
        api.fetchAll(api.listPapers),
        api.fetchAll(api.listClasses),
      ]);
    } catch (e) { mount(container, errorState(e, () => navigate(location.hash))); return; }
    container.replaceChildren();

    const crumbs = [{ label: '考试管理', href: '#/teacher/exams' }, { label: editing ? '修改考试' : '发布考试' }];
    if (editing && !['not_started', 'ongoing'].includes(exam.status)) {
      append(container, pageHead(`修改考试 - ${exam.title}`, [], crumbs),
        h('div', { class: 'card' }, h('div', { class: 'alert alert-warning' }, `考试当前状态为「${EXAM_STATUS_LABEL[exam.status]}」，不可修改。`), h('a', { class: 'btn', href: '#/teacher/exams' }, '返回考试列表')));
      return;
    }
    const onlyEnd = editing && exam.status === 'ongoing';

    if (!editing && !papers.length) {
      append(container, pageHead('发布考试', [], crumbs), h('div', { class: 'card' }, h('div', { class: 'state' }, '还没有试卷，请先组卷。', h('div', null, h('a', { class: 'btn btn-primary mt', href: '#/teacher/papers/new' }, '去组卷')))));
      return;
    }

    // 默认时间：下一个整点开始，持续 2 小时
    const now = new Date();
    const defStart = new Date(now.getTime() + 3600e3); defStart.setMinutes(0, 0, 0);
    const defEnd = new Date(defStart.getTime() + 2 * 3600e3);
    const initPaper = exam ? exam.paper_id : (query.paper_id ? Number(query.paper_id) : papers[0].id);

    const paperSel = selectEl(papers.map((p) => ({ value: p.id, label: `${p.title}（${p.question_count} 题 / ${fmtScore(p.total_score)} 分）` })), initPaper);
    if (exam && !papers.some((p) => p.id === exam.paper_id)) append(paperSel, h('option', { value: String(exam.paper_id), selected: true }, exam.paper_title));
    const titleIn = h('input', { type: 'text', maxlength: 100, value: exam ? exam.title : '' });
    const descIn = h('textarea', { rows: 3, maxlength: 1000, placeholder: '考试说明（可选），学生在考试须知中可见' });
    descIn.value = exam ? exam.description || '' : '';
    const startIn = h('input', { type: 'datetime-local', value: toLocalInput(exam ? exam.start_time : defStart.toISOString()) });
    const endIn = h('input', { type: 'datetime-local', value: toLocalInput(exam ? exam.end_time : defEnd.toISOString()) });
    const durIn = h('input', { type: 'number', min: 1, max: 1440, step: 1, value: String(exam ? exam.duration_minutes : 90) });
    const passIn = h('input', { type: 'number', min: 0, step: 0.1, value: exam ? String(exam.pass_score) : '' });
    const shuffleIn = h('input', { type: 'checkbox', checked: exam ? !!exam.shuffle_options : false });
    const selectedClasses = new Set(exam ? exam.classes.map((c) => c.id) : []);
    const classBox = h('div', { class: 'check-list' }, classes.length
      ? classes.map((c) => { const cb = h('input', { type: 'checkbox', value: String(c.id), checked: selectedClasses.has(c.id) }); cb.onchange = () => { cb.checked ? selectedClasses.add(c.id) : selectedClasses.delete(c.id); }; return h('label', { class: 'check' }, cb, `${c.name}（${c.student_count} 人）`); })
      : h('span', { class: 'muted' }, '您还没有任课班级，请联系管理员设置'));
    if (exam) for (const c of exam.classes) if (!classes.some((x) => x.id === c.id)) append(classBox, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), c.name));
    const passHint = h('div', { class: 'hint' });
    const curPaper = () => papers.find((p) => p.id === Number(paperSel.value));
    const syncPaper = () => {
      const p = curPaper();
      passHint.textContent = p ? `试卷总分 ${fmtScore(p.total_score)}，留空默认 ${fmtScore(round1(p.total_score * 0.6))}（60%）` : '';
      if (!editing && p && (!titleIn.value || titleIn.dataset.auto === '1')) { titleIn.value = p.title; titleIn.dataset.auto = '1'; }
    };
    titleIn.addEventListener('input', () => { titleIn.dataset.auto = ''; });
    paperSel.addEventListener('change', syncPaper);
    syncPaper();

    if (onlyEnd) [paperSel, titleIn, descIn, startIn, durIn, passIn, shuffleIn].forEach((el) => { el.disabled = true; });
    if (onlyEnd) classBox.querySelectorAll('input').forEach((el) => { el.disabled = true; });

    const formEl = h('div', { class: 'form' },
      onlyEnd ? h('div', { class: 'alert alert-info' }, '考试进行中，仅可延长结束时间（须晚于原结束时间）。作答中学生的截止时刻将按新结束时间重新计算。') : null,
      field('试卷', paperSel, { name: 'paper_id', required: true, hint: '发布后该试卷将被锁定，不可再编辑或删除' }),
      field('考试名称', titleIn, { name: 'title', required: true }),
      h('div', { class: 'form-row' },
        field('开始时间', startIn, { name: 'start_time', required: true }),
        field('结束时间', endIn, { name: 'end_time', required: true }),
        field('考试时长（分钟）', durIn, { name: 'duration_minutes', required: true, hint: '不超过时间窗口长度' })),
      field('参考班级', classBox, { name: 'class_ids', required: true, hint: '仅可选择本人任课班级' }),
      h('div', { class: 'form-row' },
        h('div', { class: 'field', dataset: { field: 'pass_score' } }, h('label', null, '及格线'), passIn, passHint, h('div', { class: 'error', hidden: true })),
        field('选项乱序', h('label', { class: 'check' }, shuffleIn, '单选/多选题选项按学生随机打乱'), { name: 'shuffle_options' })),
      field('考试说明', descIn, { name: 'description' }));

    const saveBtn = h('button', { class: 'btn btn-primary btn-lg' }, editing ? '保存修改' : '发布考试');
    saveBtn.addEventListener('click', async () => {
      clearFieldErrors(formEl);
      const errs = [];
      const start = fromLocalInput(startIn.value);
      const end = fromLocalInput(endIn.value);
      const dur = Number(durIn.value);
      let body;
      if (onlyEnd) {
        if (!end) errs.push({ field: 'end_time', message: '请选择结束时间' });
        else if (Date.parse(end) <= Date.parse(exam.end_time)) errs.push({ field: 'end_time', message: '新的结束时间须晚于原结束时间' });
        body = { end_time: end };
      } else {
        const p = curPaper() || (exam && { id: exam.paper_id, total_score: exam.total_score });
        const title = titleIn.value.trim();
        if (!title) errs.push({ field: 'title', message: '请输入考试名称' });
        if (!start) errs.push({ field: 'start_time', message: '请选择开始时间' });
        else if (Date.parse(start) <= Date.now()) errs.push({ field: 'start_time', message: '开始时间须晚于当前时间' });
        if (!end) errs.push({ field: 'end_time', message: '请选择结束时间' });
        else if (start && Date.parse(end) <= Date.parse(start)) errs.push({ field: 'end_time', message: '结束时间须晚于开始时间' });
        if (!Number.isInteger(dur) || dur < 1 || dur > 1440) errs.push({ field: 'duration_minutes', message: '时长须为 1~1440 的整数' });
        else if (start && end && dur > (Date.parse(end) - Date.parse(start)) / 60000) errs.push({ field: 'duration_minutes', message: '考试时长不能超过时间窗口长度' });
        if (!selectedClasses.size) errs.push({ field: 'class_ids', message: '请至少选择一个参考班级' });
        let pass = null;
        if (passIn.value !== '') {
          pass = Number(passIn.value);
          if (!(pass >= 0) || (p && pass > p.total_score)) errs.push({ field: 'pass_score', message: `及格线须在 0 ~ ${p ? fmtScore(p.total_score) : '总分'} 之间` });
        }
        body = {
          title, description: descIn.value.trim(), paper_id: Number(paperSel.value),
          start_time: start, end_time: end, duration_minutes: dur,
          class_ids: [...selectedClasses], shuffle_options: shuffleIn.checked,
        };
        if (pass != null) body.pass_score = pass; else if (!editing) body.pass_score = null;
      }
      if (errs.length) { showFieldErrors(formEl, errs); toast('请检查标红的字段', 'error'); return; }
      saveBtn.disabled = true;
      try {
        if (editing) await api.updateExam(params.id, body); else await api.createExam(body);
        toast(editing ? '考试已更新' : '考试发布成功', 'success');
        navigate('#/teacher/exams');
      } catch (e) { applyApiError(e, formEl); } finally { saveBtn.disabled = false; }
    });

    append(container, 
      pageHead(editing ? `修改考试 - ${exam.title}` : '发布考试', [], crumbs),
      h('div', { class: 'card' }, formEl),
      h('div', { class: 'sticky-actions' }, h('a', { class: 'btn btn-lg', href: '#/teacher/exams' }, '取消'), saveBtn));
  },
};
