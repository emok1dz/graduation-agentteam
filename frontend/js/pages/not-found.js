// 404
import { h } from '../utils/dom.js';
import * as store from '../store.js';

export default {
  render(container) {
    const u = store.getUser();
    container.appendChild(h('div', { class: 'done-box' },
      h('div', { class: 'state-icon' }, '404'),
      h('h2', '页面不存在'),
      h('p', { class: 'muted' }, '您访问的地址有误，或页面已被移除。'),
      h('a', { class: 'btn btn-primary', href: u ? store.homeOf(u.role) : '#/login' }, '返回首页')));
  },
};
