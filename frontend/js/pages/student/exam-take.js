// 答题页（设计文档 §5.3，FR-ANS-01~05、NFR-11）
// - 倒计时以服务端时间为准：offset = server_time − 本地时间
// - 自动保存：选择类立即保存；文本 2s 防抖；每 30s 兜底保存脏题；失败写本地草稿并指数退避重试
// - 交卷：二次确认（提示未答数）→ 按钮禁用；倒计时归零自动交卷（auto:true）；40904/40905/40906 视为已交卷
import { h, loading, errorState, clear, append, mount } from '../../utils/dom.js';
import { fmtCountdown, fmtTime, TYPES, TYPE_LABEL, fmtScore } from '../../utils/format.js';
import { renderQuestion, isAnswered } from '../../components/question-view.js';
import { confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';
import { navigate } from '../../router.js';

const CN = ['一', '二', '三', '四', '五'];
const TEXT_DEBOUNCE_MS = 2000;
const PERIODIC_SAVE_MS = 30000;
const WARN_MS = 5 * 60 * 1000;

let ctx = null; // 当前页面实例，供 unmount 清理

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 存储不可用时忽略 */ } }
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default {
  async render(container, params) {
    const examId = params.id;
    append(container, h('div', { class: 'take-page' }, loading('正在进入考试…')));

    let sheet;
    try {
      sheet = await api.startExam(examId);
    } catch (e) {
      if (e.code === 40904) { toast('您已交卷，不能再次作答', 'warning'); navigate(`#/student/results/${examId}`, { replace: true }); return; }
      if (e.code === 40905) { toast(e.message || '当前不在考试时间内', 'warning'); navigate(`#/student/exams/${examId}`, { replace: true }); return; }
      mount(container, h('div', { class: 'take-page' }, h('div', { class: 'done-box' }, errorState(e, () => navigate(location.hash)), h('a', { class: 'btn', href: '#/student/exams' }, '返回我的考试'))));
      return;
    }

    const sid = sheet.submission_id;
    const DRAFT_KEY = `exam_draft_${sid}`;
    const MARK_KEY = `exam_marks_${sid}`;
    const st = {
      offset: Date.parse(sheet.server_time) - Date.now(),
      deadline: Date.parse(sheet.deadline_at),
      responses: new Map(sheet.answers.map((a) => [a.paper_question_id, a.response ?? null])),
      dirty: new Set(),
      marked: new Set(lsGet(MARK_KEY) || []),
      saving: false, again: false, left: false, retryDelay: 2000, retryTimer: null,
      submitting: false, finished: false, warned: false,
      lastSavedAt: sheet.last_saved_at,
      timers: [],
    };
    ctx = st;
    const qById = new Map(sheet.questions.map((q) => [q.id, q]));
    const serverNow = () => Date.now() + st.offset;

    // ---------- 合并本地草稿（比服务端 last_saved_at 新时） ----------
    const draft = lsGet(DRAFT_KEY);
    if (draft && draft.answers && (!sheet.last_saved_at || Date.parse(draft.updated_at) > Date.parse(sheet.last_saved_at))) {
      for (const [k, v] of Object.entries(draft.answers)) {
        const id = Number(k);
        if (qById.has(id) && !same(st.responses.get(id), v)) { st.responses.set(id, v); st.dirty.add(id); }
      }
    }
    const writeDraft = () => {
      if (!st.dirty.size) { lsSet(DRAFT_KEY, null); return; }
      const answers = {};
      for (const id of st.dirty) answers[id] = st.responses.get(id);
      lsSet(DRAFT_KEY, { updated_at: new Date(serverNow()).toISOString(), answers });
    };

    // ---------- 顶栏 ----------
    const countdownEl = h('span', { class: 'countdown', title: '剩余时间' }, '--:--:--');
    const saveStatus = h('span', { class: 'save-status' }, st.lastSavedAt ? `已保存 ${fmtTime(st.lastSavedAt)}` : '尚未保存');
    const progressEl = h('span', { class: 'small muted' });
    const submitBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '交卷');
    const cardToggle = h('button', { class: 'btn btn-sm ac-toggle', type: 'button' }, '答题卡');
    const warnBar = h('div', { class: 'take-warning', hidden: true }, '距离考试结束不足 5 分钟，请抓紧时间！到时系统将自动交卷。');
    const offlineBar = h('div', { class: 'take-offline', hidden: navigator.onLine !== false }, '网络已断开：答案已暂存在本机，网络恢复后将自动同步。请勿关闭页面。');
    const bar = h('div', { class: 'take-bar' },
      h('div', { class: 'take-bar-inner' },
        h('span', { class: 't-title', title: sheet.exam.title }, sheet.exam.title),
        h('span', { class: 'small muted' }, '剩余'), countdownEl,
        saveStatus, progressEl, cardToggle, submitBtn),
      warnBar, offlineBar);

    // ---------- 题目区 + 答题卡 ----------
    const main = h('div', { class: 'take-main' });
    const card = h('aside', { class: 'answer-card', 'aria-label': '答题卡' });
    const acButtons = new Map();
    const qNodes = new Map();
    let number = 0;
    const numberOf = new Map();
    let sec = 0;
    const groups = TYPES.map((t) => ({ t, list: sheet.questions.filter((q) => q.type === t).sort((a, b) => a.seq - b.seq) })).filter((g) => g.list.length);

    append(card, h('h4', '答题卡'));
    for (const g of groups) {
      const sub = g.list.reduce((s, q) => s + Number(q.score || 0), 0);
      append(main, h('div', { class: 'type-section-title' }, `${CN[sec++]}、${TYPE_LABEL[g.t]}（共 ${g.list.length} 题，${fmtScore(sub)} 分）`));
      const grid = h('div', { class: 'ac-grid' });
      append(card, h('div', { class: 'ac-group-title' }, TYPE_LABEL[g.t]), grid);
      for (const q of g.list) {
        number += 1;
        numberOf.set(q.id, number);
        const markBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, st.marked.has(q.id) ? '★ 已标记' : '☆ 标记本题');
        const node = renderQuestion(q, 'answer', {
          number,
          id: `q-${q.id}`,
          response: st.responses.get(q.id),
          headExtra: markBtn,
          onChange: (r, kind) => onAnswer(q.id, r, kind),
        });
        node.classList.toggle('marked', st.marked.has(q.id));
        markBtn.onclick = () => {
          st.marked.has(q.id) ? st.marked.delete(q.id) : st.marked.add(q.id);
          markBtn.textContent = st.marked.has(q.id) ? '★ 已标记' : '☆ 标记本题';
          node.classList.toggle('marked', st.marked.has(q.id));
          lsSet(MARK_KEY, [...st.marked]);
          refreshCard();
        };
        qNodes.set(q.id, node);
        append(main, node);
        const b = h('button', { class: 'ac-item', type: 'button', title: `第 ${number} 题` }, String(number));
        b.onclick = () => { node.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.classList.remove('open'); };
        acButtons.set(q.id, b);
        append(grid, b);
      }
    }
    append(card, h('div', { class: 'ac-legend' }, h('span', null, h('i', { class: 'answered' }), '已答'), h('span', null, h('i'), '未答'), h('span', null, h('i', { class: 'marked' }), '标记')),
      h('div', { class: 'mt' }, h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => submitBtn.click() }, '交卷')));
    cardToggle.onclick = () => card.classList.toggle('open');

    const unansweredCount = () => sheet.questions.filter((q) => !isAnswered(q.type, st.responses.get(q.id))).length;
    function refreshCard() {
      for (const q of sheet.questions) {
        const b = acButtons.get(q.id);
        b.classList.toggle('answered', isAnswered(q.type, st.responses.get(q.id)));
        b.classList.toggle('marked', st.marked.has(q.id));
      }
      const done = sheet.questions.length - unansweredCount();
      progressEl.textContent = `已答 ${done}/${sheet.questions.length}`;
      cardToggle.textContent = `答题卡 ${done}/${sheet.questions.length}`;
    }

    const page = h('div', { class: 'take-page' }, bar, h('div', { class: 'take-body' }, main, card));
    mount(container, page);
    refreshCard();

    // ---------- 保存 ----------
    const setStatus = (text, kind = '') => { saveStatus.textContent = text; saveStatus.className = `save-status ${kind}`; };
    const debounced = { t: null };
    function onAnswer(id, r, kind) {
      if (st.finished || st.submitting) return;
      st.responses.set(id, r);
      st.dirty.add(id);
      writeDraft();
      refreshCard();
      setStatus('有未保存的修改…');
      if (kind === 'choice') { clearTimeout(debounced.t); saveNow(); } else {
        clearTimeout(debounced.t);
        debounced.t = setTimeout(saveNow, TEXT_DEBOUNCE_MS);
      }
    }

    async function saveNow() {
      if (st.finished || st.submitting || !st.dirty.size || (st.left && st.saving)) return;
      if (st.saving) { st.again = true; return; }
      clearTimeout(st.retryTimer);
      st.saving = true;
      const snapshot = [...st.dirty].map((id) => ({ paper_question_id: id, response: st.responses.get(id) ?? null }));
      setStatus('正在保存…');
      try {
        const r = await api.saveAnswers(sid, { answers: snapshot });
        for (const a of snapshot) if (same(st.responses.get(a.paper_question_id), a.response)) st.dirty.delete(a.paper_question_id);
        writeDraft();
        if (r.server_time) st.offset = Date.parse(r.server_time) - Date.now();
        if (r.deadline_at) st.deadline = Date.parse(r.deadline_at);
        st.lastSavedAt = r.saved_at;
        st.retryDelay = 2000;
        setStatus(st.dirty.size ? '有未保存的修改…' : `已保存 ${fmtTime(r.saved_at)}`, st.dirty.size ? '' : 'ok');
      } catch (e) {
        if (e.code === 40906 || e.code === 40905 || e.code === 40904) {
          finish({ reason: e.code === 40904 ? '您的答卷已提交' : '考试时间已到，系统已自动交卷', result: e.code === 40904 ? e.data : null });
          return;
        }
        if (e.code === 40000) {
          // 作答形状不被接受（极少见）：提示后丢弃这些题的脏标记，避免无限重试
          toast(`部分答案保存失败：${e.message}`, 'error', 5000);
          snapshot.forEach((a) => st.dirty.delete(a.paper_question_id));
          writeDraft();
          setStatus('部分答案保存失败', 'error');
        } else if (e.code !== 40100 && !st.left) {
          setStatus('保存失败，正在重试…', 'error');
          st.retryTimer = setTimeout(saveNow, st.retryDelay);
          st.retryDelay = Math.min(st.retryDelay * 2, 30000);
        }
      } finally {
        st.saving = false;
        if (st.again) { st.again = false; if (!st.finished) setTimeout(saveNow, 0); }
      }
    }

    // ---------- 交卷 ----------
    async function submit(auto) {
      if (st.finished || st.submitting) return;
      if (!auto) {
        const n = unansweredCount();
        const msg = n ? `您还有 ${n} 道题未作答，确定要交卷吗？\n交卷后将不能修改答案。` : '所有题目均已作答。确定要交卷吗？\n交卷后将不能修改答案。';
        if (!(await confirm('确认交卷', msg, { okText: '确认交卷', cancelText: '继续作答', danger: n > 0 }))) return;
        if (st.finished) return;
      }
      st.submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '交卷中…';
      clearTimeout(debounced.t); clearTimeout(st.retryTimer);
      const answers = [...st.dirty].map((id) => ({ paper_question_id: id, response: st.responses.get(id) ?? null }));
      const attempt = async (delay = 2000) => {
        try {
          const r = await api.submitSubmission(sid, { answers, auto: !!auto });
          finish({ reason: auto ? '考试时间到，已自动交卷' : '交卷成功', result: r });
        } catch (e) {
          if (e.code === 40904) { finish({ reason: '答卷已提交', result: e.data }); return; }
          if (e.code === 40906 || e.code === 40905) { finish({ reason: '考试时间已到，系统已自动交卷' }); return; }
          if (e.code === api.NETWORK_ERROR || e.http >= 500) {
            if (auto) { setStatus('网络异常，正在重试交卷…', 'error'); st.retryTimer = setTimeout(() => attempt(Math.min(delay * 2, 15000)), delay); return; }
            toast('交卷失败：网络异常，请检查网络后重试', 'error', 4000);
          } else toast(e.message || '交卷失败', 'error', 4000);
          st.submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = '交卷';
        }
      };
      await attempt();
    }
    submitBtn.onclick = () => submit(false);

    function finish({ reason, result }) {
      if (st.finished) return;
      st.finished = true;
      cleanup();
      lsSet(DRAFT_KEY, null);
      lsSet(MARK_KEY, null);
      const late = result && result.answers_accepted === false;
      clear(container);
      append(container, h('div', { class: 'take-page' }, h('div', { class: 'done-box' },
        h('div', { class: 'done-icon' }, '✓'),
        h('h2', reason),
        h('p', { class: 'muted' }, sheet.exam.title),
        late ? h('div', { class: 'alert alert-warning' }, '已超过作答截止时间，系统按最后一次保存的答案交卷。') : null,
        result && result.submitted_at ? h('p', { class: 'small muted' }, `交卷时间：${fmtTime(result.submitted_at)}`) : null,
        h('p', '已交卷，等待成绩发布。'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('a', { class: 'btn', href: '#/student/exams' }, '返回我的考试'),
          h('a', { class: 'btn btn-primary', href: '#/student/results' }, '我的成绩')))));
    }

    // ---------- 倒计时 ----------
    function tick() {
      if (st.finished) return;
      const remain = st.deadline - serverNow();
      countdownEl.textContent = fmtCountdown(remain);
      const warn = remain <= WARN_MS;
      countdownEl.classList.toggle('warn', warn);
      warnBar.hidden = !warn;
      if (warn && !st.warned) { st.warned = true; toast('距离考试结束不足 5 分钟！', 'warning', 5000); }
      if (remain <= 0 && !st.submitting) submit(true);
    }
    tick();
    st.timers.push(setInterval(tick, 1000));
    st.timers.push(setInterval(() => { if (st.dirty.size) saveNow(); }, PERIODIC_SAVE_MS));

    // ---------- 网络与离开页面 ----------
    const onOnline = () => { offlineBar.hidden = true; toast('网络已恢复', 'success'); st.retryDelay = 2000; saveNow(); };
    const onOffline = () => { offlineBar.hidden = false; setStatus('网络已断开，答案暂存本机', 'error'); };
    const onBeforeUnload = (e) => { if (!st.finished && st.dirty.size) { writeDraft(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeunload', onBeforeUnload);

    function cleanup() {
      st.timers.forEach(clearInterval);
      st.timers = [];
      clearTimeout(debounced.t);
      clearTimeout(st.retryTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
    st.cleanup = cleanup;
    st.flush = () => { if (!st.finished && st.dirty.size) { writeDraft(); saveNow(); } };

    // 本地草稿合并后立即保存
    if (st.dirty.size) { toast('已恢复本机暂存的答案', 'info'); saveNow(); }
  },
  unmount() {
    if (!ctx) return;
    const c = ctx; ctx = null;
    if (c.flush) c.flush(); // 离开页面前尽力保存（失败时答案仍在本地草稿中，下次进入会合并）
    c.left = true;
    if (c.cleanup) c.cleanup();
  },
};
