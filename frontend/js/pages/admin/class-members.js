// 班级成员：加入/移出学生（转班二次确认）、设置任课教师（FR-CLASS-02）
import { h, pageHead, loadInto, badge, loading, errorState, qsa, append, mount } from '../../utils/dom.js';
import { USER_STATUS_LABEL } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { openModal, confirm, toast } from '../../components/modal.js';
import * as api from '../../api.js';

export default {
  async render(container, params) {
    const classId = Number(params.id);
    const body = h('div');
    append(container, body);

    const load = () => loadInto(body, () => api.getClassMembers(classId), (m) => view(m));

    function view(m) {
      const c = m.class;
      const selected = new Set();
      const removeBtn = h('button', { class: 'btn btn-danger btn-sm', disabled: true, onclick: () => removeStudents([...selected]) }, '移出所选');
      const updateBtn = () => { removeBtn.disabled = selected.size === 0; removeBtn.textContent = selected.size ? `移出所选（${selected.size}）` : '移出所选'; };
      const allBox = h('input', { type: 'checkbox', 'aria-label': '全选' });
      allBox.addEventListener('change', () => {
        for (const cb of qsa('input[data-sid]', body)) { cb.checked = allBox.checked; cb.checked ? selected.add(Number(cb.dataset.sid)) : selected.delete(Number(cb.dataset.sid)); }
        updateBtn();
      });
      const columns = [
        { title: allBox, render: (s) => { const cb = h('input', { type: 'checkbox', dataset: { sid: s.id } }); cb.addEventListener('change', () => { cb.checked ? selected.add(s.id) : selected.delete(s.id); updateBtn(); }); return cb; } },
        { title: '学号', key: 'username' },
        { title: '姓名', key: 'name' },
        { title: '状态', render: (s) => badge(USER_STATUS_LABEL[s.status] || s.status || '启用', s.status === 'disabled' ? 'danger' : 'success') },
        { title: '操作', render: (s) => h('button', { class: 'link-btn danger', onclick: () => removeStudents([s.id]) }, '移出') },
      ];
      return [
        pageHead(`班级成员 - ${c.name}`, [h('a', { class: 'btn', href: '#/admin/classes' }, '返回班级列表')],
          [{ label: '班级管理', href: '#/admin/classes' }, { label: c.name }]),
        h('div', { class: 'card' },
          h('dl', { class: 'kv' },
            h('dt', '年级'), h('dd', c.grade || '—'),
            h('dt', '专业'), h('dd', c.major || '—'),
            h('dt', '学生人数'), h('dd', String(m.students.length)),
            h('dt', '备注'), h('dd', { class: 'pre' }, c.remark || '—'))),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', '任课教师'), h('button', { class: 'btn btn-sm', onclick: () => editTeachers(m.teachers) }, '设置任课教师')),
          m.teachers.length ? h('div', { class: 'chips' }, m.teachers.map((t) => h('span', { class: 'chip' }, `${t.name}（${t.username}）`))) : h('div', { class: 'muted' }, '尚未设置任课教师')),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', `学生名单（${m.students.length}）`), removeBtn, h('button', { class: 'btn btn-primary btn-sm', onclick: () => addStudents(m.students) }, '+ 添加学生')),
          renderTable(columns, m.students, { empty: '班级暂无学生' })),
      ];
    }

    async function removeStudents(ids) {
      if (!ids.length) return;
      if (!(await confirm('移出学生', `确定将选中的 ${ids.length} 名学生移出本班吗？`, { danger: true }))) return;
      try { await api.removeClassStudents(classId, { student_ids: ids }); toast('已移出', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
    }

    async function editTeachers(current) {
      const listBox = h('div', null, loading());
      const save = h('button', { class: 'btn btn-primary', disabled: true }, '保存');
      const cancel = h('button', { class: 'btn' }, '取消');
      const m = openModal({ title: '设置任课教师', body: listBox, footer: [cancel, save] });
      cancel.onclick = () => m.close();
      try {
        const teachers = await api.fetchAll(api.listUsers, { role: 'teacher' });
        const cur = new Set(current.map((t) => t.id));
        mount(listBox, teachers.length
          ? h('div', { class: 'check-list col' }, teachers.map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: String(t.id), checked: cur.has(t.id) }), `${t.name}（${t.username}）`, t.status === 'disabled' ? h('span', { class: 'muted small' }, ' 已禁用') : null)))
          : h('div', { class: 'muted' }, '系统中暂无教师账号'));
        save.disabled = false;
      } catch (e) { mount(listBox, errorState(e)); }
      save.onclick = async () => {
        const ids = qsa('input[type=checkbox]', listBox).filter((c) => c.checked).map((c) => Number(c.value));
        save.disabled = true;
        try { await api.setClassTeachers(classId, { teacher_ids: ids }); toast('任课教师已更新', 'success'); m.close(); load(); } catch (e) { toast(e.message, 'error'); save.disabled = false; }
      };
    }

    async function addStudents(currentStudents) {
      const inClass = new Set(currentStudents.map((s) => s.id));
      const chosen = new Map();
      const kw = h('input', { type: 'search', placeholder: '按学号 / 姓名搜索', maxlength: 50 });
      const listBox = h('div');
      const info = h('span', { class: 'muted' }, '已选 0 人');
      const save = h('button', { class: 'btn btn-primary' }, '加入本班');
      const cancel = h('button', { class: 'btn' }, '取消');
      const m = openModal({ title: '添加学生', wide: true, body: h('div', null, h('div', { class: 'filters' }, kw, h('button', { class: 'btn', onclick: () => search() }, '搜索')), listBox), footer: [info, cancel, save] });
      cancel.onclick = () => m.close();
      const sync = () => { info.textContent = `已选 ${chosen.size} 人`; };
      const search = () => loadInto(listBox, () => api.listUsers({ role: 'student', keyword: kw.value.trim(), page: 1, page_size: 50 }), (data) => {
        const rows = data.items;
        return [renderTable([
          { title: '', render: (s) => { if (inClass.has(s.id)) return h('span', { class: 'muted small' }, '已在本班'); const cb = h('input', { type: 'checkbox', checked: chosen.has(s.id) }); cb.onchange = () => { cb.checked ? chosen.set(s.id, s) : chosen.delete(s.id); sync(); }; return cb; } },
          { title: '学号', key: 'username' },
          { title: '姓名', key: 'name' },
          { title: '当前班级', render: (s) => s.class_name || '（未分班）' },
        ], rows, { empty: '没有找到学生' }), data.total > rows.length ? h('div', { class: 'muted small mt' }, `共 ${data.total} 人，仅显示前 ${rows.length} 人，请输入关键字缩小范围`) : null];
      });
      kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
      search();
      save.onclick = async () => {
        const ids = [...chosen.keys()];
        if (!ids.length) { toast('请先选择学生', 'warning'); return; }
        save.disabled = true;
        try {
          await submit(ids, false);
          m.close();
        } catch (e) {
          if (e.code === 40909 && e.data && Array.isArray(e.data.conflicts)) {
            const msg = h('div', null,
              h('p', '以下学生已属于其他班级，确认后将从原班级转入本班：'),
              h('ul', null, e.data.conflicts.map((c) => h('li', `${c.name}（${c.username}）—— 当前班级：${c.current_class_name || c.current_class_id}`))));
            if (await confirm('学生转班确认', msg, { okText: '确认转入' })) {
              try { await submit(ids, true); m.close(); } catch (e2) { toast(e2.message, 'error'); }
            }
          } else toast(e.message, 'error');
        } finally { save.disabled = false; }
      };
      async function submit(ids, force) {
        await api.addClassStudents(classId, { student_ids: ids, force_move: force });
        toast(`已加入 ${ids.length} 名学生`, 'success');
        load();
      }
    }

    load();
  },
};
