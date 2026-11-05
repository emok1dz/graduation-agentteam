// 入口：加载 config → 打开 JsonStore → 空库则 seed → createApp → listen → 启动 scheduler
// 用法：node server.mjs（PORT / DATA_DIR / FRONTEND_DIR 等环境变量见 README）
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './src/config.mjs';
import { JsonStore } from './src/repositories/json-store.mjs';
import { createRepositories } from './src/repositories/index.mjs';
import { createServices } from './src/services/index.mjs';
import { createApp } from './src/app.mjs';
import { seedIfEmpty } from './src/seed.mjs';

export { createApp };

/**
 * 可编程启动（供测试使用）
 * @param {{port?: number, host?: string, dataDir?: string, frontendDir?: string, scheduler?: boolean, seed?: boolean, config?: object}} opts
 * @returns {Promise<http.Server & {url: string, port: number, stop: () => Promise<void>, store, repos, services, config, app}>}
 */
export async function start(opts = {}) {
  const config = loadConfig({
    ...(opts.config || {}),
    PORT: opts.port,
    HOST: opts.host,
    DATA_DIR: opts.dataDir,
    FRONTEND_DIR: opts.frontendDir,
  });
  const store = await JsonStore.open(path.join(config.DATA_DIR, 'db.json'));
  const repos = createRepositories(store);
  if (opts.seed !== false && config.SEED) await seedIfEmpty(repos);
  const services = createServices({ repos, config });
  const app = createApp({ config, repos, services });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (opts.scheduler !== false) services.scheduler.start();
  server.on('close', () => services.scheduler.stop());
  const port = server.address().port;
  let stopped = null;
  Object.assign(server, {
    app, config, store, repos, services, port,
    url: `http://127.0.0.1:${port}`,
    stop() {
      if (!stopped) {
        stopped = (async () => {
          services.scheduler.stop();
          await new Promise((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections?.();
          });
          await store.flush();
        })();
      }
      return stopped;
    },
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  start()
    .then((server) => {
      const { config } = server;
      console.log(`[online-exam] listening on http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${server.port}`);
      console.log(`[online-exam] data: ${path.join(config.DATA_DIR, 'db.json')}  frontend: ${config.FRONTEND_DIR}`);
      const shutdown = async (sig) => {
        console.log(`[online-exam] ${sig} received, flushing data...`);
        const timer = setTimeout(() => process.exit(1), 5000);
        try {
          await server.stop();
        } finally {
          clearTimeout(timer);
          process.exit(0);
        }
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((e) => {
      console.error('[online-exam] failed to start:', e.message);
      process.exit(1);
    });
}
