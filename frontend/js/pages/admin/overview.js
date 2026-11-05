// 管理员首页：系统概览（P2；接口未实现时显示欢迎页）
import { h, pageHead, loading, append, mount } from '../../utils/dom.js';
import * as api from '../../api.js';
import * as store from '../../store.js';

function stat(label, value, kind = '', sub = '') {
  return h('div', { class: ['stat', kind] }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, String(value ?? 0)), sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

const quick = () => h('div', { class: 'card' }, h('h3', '快捷入口'),
  h('div', { class: 'row' },
    h('a', { class: 'btn', href: '#/admin/users' }, '用户管理'),
    h('a', { class: 'btn', href: '#/admin/classes' }, '班级管理'),
    h('a', { class: 'btn', href: '#/admin/exams' }, '考试总览')));

export default {
  async render(container) {
    const user = store.getUser();
    const body = h('div', null, loading());
    append(container, pageHead('系统概览'), body);
    try {
      const o = await api.getOverview();
      const u = o.users || {}; const e = o.exams || {};
      mount(body, 
        h('h3', '用户'),
        h('div', { class: 'stats-grid' },
          stat('用户总数', u.total, 'primary'), stat('管理员', u.admin), stat('教师', u.teacher), stat('学生', u.student)),
        h('h3', '教学资源'),
        h('div', { class: 'stats-grid' },
          stat('班级', o.class_count), stat('题目', o.question_count), stat('试卷', o.paper_count)),
        h('h3', '考试'),
        h('div', { class: 'stats-grid' },
          stat('考试总数', e.total, 'primary'), stat('未开始', e.not_started, 'warning'), stat('进行中', e.ongoing, 'success'), stat('已结束', e.ended), stat('已取消', e.cancelled, 'danger')),
        quick());
    } catch (err) {
      mount(body, 
        h('div', { class: 'card' }, h('h2', `欢迎，${user.name}`),
          h('p', { class: 'muted' }, err.code === 40400 || err.code === 40500 ? '系统概览功能暂未开放。' : `概览数据加载失败：${err.message}`)),
        quick());
    }
  },
};
