// 启动：store.restore() → 有 token 则 api.getMe() → router.start()
import * as store from './store.js';
import * as api from './api.js';
import * as router from './router.js';

function watchNetwork() {
  const banner = document.getElementById('net-banner');
  const update = () => { if (banner) banner.hidden = navigator.onLine !== false; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

async function boot() {
  store.restore();
  watchNetwork();
  if (store.getToken()) {
    try {
      const me = await api.getMe();
      store.setUser(me);
    } catch (e) {
      // 网络异常时保留本地缓存的用户信息，其余错误（令牌失效等）清除登录态
      if (!(e instanceof api.ApiError) || e.code !== api.NETWORK_ERROR) store.clearAuth();
    }
  }
  router.start(document.getElementById('app'));
}

window.addEventListener('unhandledrejection', (e) => {
  // 业务错误已在页面内处理；这里只防止控制台噪音掩盖真正的脚本错误
  if (e.reason && e.reason.name === 'ApiError') e.preventDefault();
});

boot();
