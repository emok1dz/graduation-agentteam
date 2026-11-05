// 用户管理：列表/筛选/新增/编辑/禁用/启用/重置密码/删除（FR-USER-01~03）
import { h, pageHead, loadInto, badge, append } from '../../utils/dom.js';
import { fmtDateTime, ROLE_LABEL, USER_STATUS_LABEL, options } from '../../utils/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { formDialog, confirm, toast } from '../../components/modal.js';
import { selectEl } from '../../components/form.js';
import * as api from '../../api.js';
import * as store from '../../store.js';
import { setQuery, reload } from '../../router.js';

const USERNAME_RE = /^[A-Za-z0-9_]{4,20}$/;
const PWD_RE = /^(?=.*[A-Za-z])(?=.*\d).{6,32}$/;

export default {
  async render(container, params, query) {
    const me = store.getUser();
    let classes = [];
    try { classes = await api.fetchAll(api.listClasses); } catch { /* 班级加载失败不影响列表 */ }
    const classOpts = classes.map((c) => ({ value: c.id, label: c.name }));

    const q = {
      role: query.role || '', class_id: query.class_id || '', status: query.status || '', keyword: query.keyword || '',
      page: Number(query.page) || 1, page_size: 10,
    };

    const roleSel = selectEl([{ value: '', label: '全部角色' }, ...options(ROLE_LABEL)], q.role);
    const classSel = selectEl([{ value: '', label: '全部班级' }, ...classOpts], q.class_id);
    const statusSel = selectEl([{ value: '', label: '全部状态' }, ...options(USER_STATUS_LABEL)], q.status);
    const kw = h('input', { type: 'search', placeholder: '账号 / 姓名', value: q.keyword, maxlength: 50 });
    const search = () => setQuery({ role: roleSel.value, class_id: classSel.value, status: statusSel.value, keyword: kw.value.trim(), page: 1 });
    kw.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    [roleSel, classSel, statusSel].forEach((s) => s.addEventListener('change', search));

    const listEl = h('div');
    append(container, 
      pageHead('用户管理', [h('button', { class: 'btn btn-primary', onclick: () => openCreate() }, '+ 新增用户')]),
      h('div', { class: 'card' },
        h('div', { class: 'filters' }, roleSel, classSel, statusSel, kw, h('button', { class: 'btn', onclick: search }, '查询')),
        listEl));

    const classFieldVisible = (v) => v.role === 'student';

    async function openCreate() {
      const ok = await formDialog({
        title: '新增用户',
        fields: [
          { name: 'username', label: '账号', required: true, placeholder: '4~20 位字母、数字、下划线', hint: '创建后不可修改' },
          { name: 'name', label: '姓名', required: true, attrs: { maxlength: 20 } },
          { name: 'role', label: '角色', type: 'select', required: true, options: options(ROLE_LABEL) },
          { name: 'class_id', label: '所属班级', type: 'select', numeric: true, options: [{ value: '', label: '请选择班级' }, ...classOpts], visibleWhen: classFieldVisible },
          { name: 'password', label: '初始密码', type: 'password', trim: false, placeholder: '留空则使用默认初始密码', hint: '6~32 位，须同时包含字母与数字', autocomplete: 'new-password' },
        ],
        initial: { role: 'student' },
        validate: (v) => {
          const errs = [];
          if (v.username && !USERNAME_RE.test(v.username)) errs.push({ field: 'username', message: '账号须为 4~20 位字母、数字或下划线' });
          if (v.role === 'student' && !v.class_id) errs.push({ field: 'class_id', message: '学生必须选择所属班级' });
          if (v.password && !PWD_RE.test(v.password)) errs.push({ field: 'password', message: '密码须为 6~32 位且同时包含字母与数字' });
          return errs;
        },
        onSubmit: (v) => api.createUser({
          username: v.username, name: v.name, role: v.role,
          password: v.password ? v.password : null,
          class_id: v.role === 'student' ? v.class_id : null,
        }),
      });
      if (ok) { toast('用户已创建', 'success'); reload(); }
    }

    async function openEdit(u) {
      const fields = [
        { name: 'username', label: '账号', attrs: { disabled: true } },
        { name: 'name', label: '姓名', required: true, attrs: { maxlength: 20 } },
      ];
      if (u.role === 'student') fields.push({ name: 'class_id', label: '所属班级', type: 'select', numeric: true, options: [{ value: '', label: '（无班级）' }, ...classOpts] });
      fields.push({ name: 'status', label: '状态', type: 'select', options: options(USER_STATUS_LABEL), attrs: { disabled: u.id === me.id } });
      const ok = await formDialog({
        title: `编辑用户 - ${u.username}`,
        fields,
        initial: { username: u.username, name: u.name, class_id: u.class_id ?? '', status: u.status },
        onSubmit: (v) => {
          const body = { name: v.name };
          if (u.role === 'student') body.class_id = v.class_id;
          if (u.id !== me.id) body.status = v.status;
          return api.updateUser(u.id, body);
        },
      });
      if (ok) { toast('已保存', 'success'); reload(); }
    }

    async function toggleStatus(u) {
      const to = u.status === 'active' ? 'disabled' : 'active';
      const ok = await confirm(to === 'disabled' ? '禁用用户' : '启用用户',
        to === 'disabled' ? `确定禁用「${u.name}（${u.username}）」吗？禁用后该用户将立即下线且无法登录。` : `确定启用「${u.name}（${u.username}）」吗？`,
        { danger: to === 'disabled' });
      if (!ok) return;
      try { await api.updateUser(u.id, { status: to }); toast(to === 'disabled' ? '已禁用' : '已启用', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
    }

    async function resetPwd(u) {
      const ok = await confirm('重置密码', `确定将「${u.name}（${u.username}）」的密码重置为默认初始密码吗？该用户的登录将全部失效。`, { danger: true });
      if (!ok) return;
      try { await api.resetUserPassword(u.id); toast('密码已重置为默认初始密码', 'success'); } catch (e) { toast(e.message, 'error'); }
    }

    async function remove(u) {
      const ok = await confirm('删除用户', `确定删除「${u.name}（${u.username}）」吗？此操作不可恢复。\n已产生答卷的学生或已创建题目/考试的教师不能删除，只能禁用。`, { danger: true, okText: '删除' });
      if (!ok) return;
      try { await api.deleteUser(u.id); toast('已删除', 'success'); reload(); } catch (e) { toast(e.message, 'error', 4000); }
    }

    const columns = [
      { title: '账号', key: 'username' },
      { title: '姓名', key: 'name' },
      { title: '角色', render: (u) => ROLE_LABEL[u.role] || u.role },
      { title: '所属班级', render: (u) => u.class_name || (u.role === 'student' ? '（未分班）' : '—') },
      { title: '状态', render: (u) => badge(USER_STATUS_LABEL[u.status] || u.status, u.status === 'active' ? 'success' : 'danger') },
      { title: '创建时间', className: 'nowrap', render: (u) => fmtDateTime(u.created_at) },
      {
        title: '操作', className: 'nowrap', render: (u) => h('div', { class: 'btn-group' },
          h('button', { class: 'link-btn', onclick: () => openEdit(u) }, '编辑'),
          h('button', { class: 'link-btn', disabled: u.id === me.id, onclick: () => toggleStatus(u) }, u.status === 'active' ? '禁用' : '启用'),
          h('button', { class: 'link-btn', onclick: () => resetPwd(u) }, '重置密码'),
          h('button', { class: 'link-btn danger', disabled: u.id === me.id, onclick: () => remove(u) }, '删除')),
      },
    ];

    await loadInto(listEl, () => api.listUsers(q), (data) => [
      renderTable(columns, data.items, { empty: '没有符合条件的用户' }),
      renderPagination(data, (p) => setQuery({ page: p })),
    ]);
  },
};
