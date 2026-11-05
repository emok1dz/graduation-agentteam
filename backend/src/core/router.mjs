// 轻量路由：方法 + 路径参数匹配；字面量路径优先于参数路径
import { fail, badField } from './errors.mjs';

export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, { roles, handler, name }) {
    const segs = path.split('/').filter(Boolean);
    const literalCount = segs.filter((s) => !s.startsWith(':')).length;
    this.routes.push({ method, path, segs, literalCount, roles, handler, name });
    return this;
  }
  /**
   * 返回 {route, params, paramError}；无匹配路径抛 40400，路径匹配但方法不匹配抛 40500；
   * 路径参数非法时 paramError 为 40000 错误（由接入层在鉴权之后抛出，避免未登录请求探测参数）
   */
  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    const candidates = [];
    for (const r of this.routes) {
      if (r.segs.length !== parts.length) continue;
      let ok = true;
      const raw = {};
      for (let i = 0; i < r.segs.length; i++) {
        const s = r.segs[i];
        if (s.startsWith(':')) raw[s.slice(1)] = parts[i];
        else if (s !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) candidates.push({ route: r, raw });
    }
    if (candidates.length === 0) throw fail('NOT_FOUND', '接口不存在');
    const best = Math.max(...candidates.map((c) => c.route.literalCount));
    const top = candidates.filter((c) => c.route.literalCount === best);
    const hit = top.find((c) => c.route.method === method);
    if (!hit) throw fail('METHOD_NOT_ALLOWED');
    const params = {};
    let paramError = null;
    for (const [k, v] of Object.entries(hit.raw)) {
      let s;
      try {
        s = decodeURIComponent(v);
      } catch {
        s = v;
      }
      if (!/^[1-9]\d{0,15}$/.test(s) || !Number.isSafeInteger(Number(s))) {
        paramError = paramError || badField(k, `路径参数 ${k} 必须为正整数`);
        continue;
      }
      params[k] = Number(s);
    }
    return { route: hit.route, params, paramError };
  }
}
