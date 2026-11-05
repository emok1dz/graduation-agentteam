// createApp：接入层（安全响应头 → 静态文件 / API 分发 → 统一响应信封 → 错误兜底）
import { Router } from './core/router.mjs';
import { readJsonBody, sendJson, parseQuery } from './core/http.mjs';
import { AppError } from './core/errors.mjs';
import { serveStatic } from './core/static.mjs';
import { now as clockNow } from './core/clock.mjs';
import { createAuth } from './middleware/auth.mjs';
import { registerRoutes } from './routes/index.mjs';
import { createControllers } from './controllers/index.mjs';

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'");
}

const BODYLESS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/** @returns {(req, res) => Promise<void>} */
export function createApp({ config, services }) {
  const router = registerRoutes(new Router(), createControllers(services));
  const auth = createAuth(services);
  const serve = serveStatic(config.FRONTEND_DIR);

  return async function handler(req, res) {
    setSecurityHeaders(res);
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad Request');
    }
    const pathname = url.pathname;
    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      try {
        await serve(req, res, pathname);
      } catch (e) {
        console.error('[static]', e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
      return;
    }
    const ctx = {
      req, res, method: req.method, path: pathname, params: {}, query: parseQuery(url.searchParams),
      body: undefined, user: null, session: null, now: clockNow(), status: 200, handled: false,
    };
    try {
      const { route, params, paramError } = router.match(req.method, pathname);
      ctx.params = params;
      if (!BODYLESS.has(req.method)) ctx.body = await readJsonBody(req, config.BODY_LIMIT);
      else req.resume();
      if (!route.roles.includes('public')) await auth.authenticate(ctx);
      auth.requireRole(ctx, route.roles);
      if (paramError) throw paramError;
      const data = await route.handler(ctx);
      if (ctx.handled) return;
      sendJson(res, ctx.status || 200, { code: 0, message: 'ok', data: data === undefined ? null : data });
    } catch (e) {
      if (e instanceof AppError) {
        sendJson(res, e.http, { code: e.code, message: e.message, data: e.data ?? null });
      } else {
        console.error('[api]', req.method, pathname, e);
        sendJson(res, 500, { code: 50000, message: '服务器内部错误', data: null });
      }
    }
  };
}
