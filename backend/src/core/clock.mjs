// 服务端时钟：所有业务时间均取自这里；测试可通过 setNow / advance 注入假时钟
let fixed = null; // 固定时刻（ms）
let offset = 0;   // 相对真实时间的偏移（ms）

export function now() {
  return new Date(fixed !== null ? fixed : Date.now() + offset);
}
export function nowMs() {
  return now().getTime();
}
export function nowIso() {
  return now().toISOString();
}
/** 仅测试使用：固定时钟到某时刻；传 null 恢复真实时间 */
export function setNow(date) {
  fixed = date === null || date === undefined ? null : new Date(date).getTime();
  if (fixed === null) offset = 0;
}
/** 仅测试使用：时钟前进 ms 毫秒（固定或偏移模式均可） */
export function advance(ms) {
  if (fixed !== null) fixed += ms;
  else offset += ms;
}
export function reset() {
  fixed = null;
  offset = 0;
}
