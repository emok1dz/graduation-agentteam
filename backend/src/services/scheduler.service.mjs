// 定时任务：每 30s sweepAll（超时强制交卷 + 缺考生成）；每 10min 清理过期会话
import { now as clockNow } from '../core/clock.mjs';

export function createSchedulerService({ config, svc }) {
  let timers = [];
  const safe = (name, fn) => async () => {
    try {
      await fn(clockNow());
    } catch (e) {
      console.error(`[scheduler] ${name} failed:`, e);
    }
  };
  const sweep = safe('sweepAll', (now) => svc.answer.sweepAll(now));
  const clean = safe('cleanSessions', (now) => svc.auth.cleanExpiredSessions(now));
  return {
    sweepAll: (now = clockNow()) => svc.answer.sweepAll(now),
    start({ sweepIntervalMs = config.SWEEP_INTERVAL_MS, cleanIntervalMs = config.SESSION_CLEAN_MS } = {}) {
      this.stop();
      timers = [setInterval(sweep, sweepIntervalMs), setInterval(clean, cleanIntervalMs)];
      for (const t of timers) t.unref?.();
      sweep();
      return () => this.stop();
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },
  };
}
