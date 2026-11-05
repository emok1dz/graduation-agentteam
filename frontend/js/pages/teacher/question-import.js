// 批量导入题目（FR-QB-05，P2）：粘贴或选择 JSON 文件
import { h, pageHead, append, mount } from '../../utils/dom.js';
import { renderTable } from '../../components/table.js';
import { toast } from '../../components/modal.js';
import * as api from '../../api.js';

const SAMPLE = [
  { type: 'single', stem: 'HTTP 协议默认端口是？', options: [{ key: 'A', text: '21' }, { key: 'B', text: '80' }, { key: 'C', text: '443' }], answer: 'B', difficulty: 'easy', score: 2, tags: ['计算机网络'], analysis: 'HTTP 默认 80，HTTPS 默认 443。' },
  { type: 'multiple', stem: '以下属于线性结构的是？', options: [{ key: 'A', text: '数组' }, { key: 'B', text: '链表' }, { key: 'C', text: '二叉树' }, { key: 'D', text: '栈' }], answer: ['A', 'B', 'D'], difficulty: 'medium', score: 4, tags: ['数据结构'] },
  { type: 'judge', stem: 'TCP 是面向连接的协议。', answer: true, difficulty: 'easy', score: 2 },
  { type: 'fill', stem: '中华人民共和国的首都是___，成立于___年。', answer: [['北京', 'Beijing'], ['1949']], difficulty: 'easy', score: 4 },
  { type: 'essay', stem: '简述进程与线程的区别。', answer: '进程是资源分配的基本单位，线程是调度的基本单位……', difficulty: 'hard', score: 10 },
];

export default {
  render(container) {
    const ta = h('textarea', { rows: 16, placeholder: '粘贴题目 JSON 数组，字段同“新增题目”：type / stem / options / answer / difficulty / score / tags / analysis' });
    const file = h('input', { type: 'file', accept: '.json,application/json,text/plain' });
    const resultEl = h('div');
    const btn = h('button', { class: 'btn btn-primary' }, '开始导入');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { toast('文件不能超过 1MB', 'error'); return; }
      const r = new FileReader();
      r.onload = () => { ta.value = String(r.result || ''); };
      r.onerror = () => toast('读取文件失败', 'error');
      r.readAsText(f, 'utf-8');
    });
    btn.addEventListener('click', async () => {
      let data;
      try { data = JSON.parse(ta.value); } catch (e) { toast('JSON 格式错误：' + e.message, 'error', 5000); return; }
      const questions = Array.isArray(data) ? data : data && Array.isArray(data.questions) ? data.questions : null;
      if (!questions) { toast('内容须为题目数组，或 {"questions": [...]}', 'error'); return; }
      if (!questions.length) { toast('题目数组为空', 'warning'); return; }
      if (questions.length > 200) { toast(`单次最多导入 200 题，当前 ${questions.length} 题`, 'error'); return; }
      btn.disabled = true; btn.textContent = '导入中…';
      try {
        const r = await api.importQuestions({ questions });
        mount(resultEl, h('div', { class: 'card' },
          h('h3', '导入结果'),
          h('div', { class: ['alert', r.fail_count ? 'alert-warning' : 'alert-success'] }, `成功 ${r.success_count} 题，失败 ${r.fail_count} 题`),
          r.failures && r.failures.length ? renderTable([
            { title: '序号', className: 'nowrap', render: (f) => `第 ${f.index + 1} 题` },
            { title: '题干', render: (f) => String((questions[f.index] && questions[f.index].stem) || '').slice(0, 40) },
            { title: '失败原因', render: (f) => (f.errors || []).map((e) => `${e.field}: ${e.message}`).join('；') },
          ], r.failures) : null,
          h('div', { class: 'mt' }, h('a', { class: 'btn', href: '#/teacher/questions' }, '返回题库'))));
        if (r.success_count) toast(`已导入 ${r.success_count} 题`, 'success');
      } catch (e) {
        toast(e.message, 'error', 5000);
      } finally { btn.disabled = false; btn.textContent = '开始导入'; }
    });
    append(container, 
      pageHead('批量导入题目', [h('a', { class: 'btn', href: '#/teacher/questions' }, '返回题库')], [{ label: '题库管理', href: '#/teacher/questions' }, { label: '批量导入' }]),
      h('div', { class: 'card' },
        h('div', { class: 'alert alert-info' }, '支持粘贴 JSON 文本或选择 .json 文件；逐条校验，通过的导入、失败的给出原因；单次最多 200 题。填空题 answer 为每空一组可接受答案的二维数组。'),
        h('div', { class: 'row mb' }, file, h('button', { class: 'btn btn-sm', onclick: () => { ta.value = JSON.stringify(SAMPLE, null, 2); } }, '填入示例')),
        ta,
        h('div', { class: 'form-actions mt' }, btn)),
      resultEl);
  },
};
