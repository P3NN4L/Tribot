// ===== 路由健康度：失败熔断 + 会话粘性 =====
// 只影响「自动路由」的排序，不改变用户显式选择。

interface Failure {
  at: number;
  count: number;
}

const failures = new Map<string, Failure>();
const COOLDOWN_MS = 3 * 60_000;

export function recordRouteFailure(provider: string, now = Date.now()): void {
  const cur = failures.get(provider);
  failures.set(provider, { at: now, count: (cur?.count ?? 0) + 1 });
}

export function recordRouteSuccess(provider: string): void {
  failures.delete(provider);
}

/** 最近 3 分钟失败过的供应商，在自动路由里降权 */
export function isCooling(provider: string, now = Date.now()): boolean {
  const f = failures.get(provider);
  return !!f && now - f.at < COOLDOWN_MS;
}

export function coolingProviders(now = Date.now()): string[] {
  return [...failures.entries()].filter(([, f]) => now - f.at < COOLDOWN_MS).map(([p]) => p);
}

/** 测试用：清空熔断状态 */
export function resetRouteHealth(): void {
  failures.clear();
}
