import type { ProviderId, QuotaSnapshot } from '@tribot/shared';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import { PROVIDER_DEFS } from '../llm/registry.js';
import { deepseekPeriod, weekStartShanghai, window5hStart } from './clock.js';
import { getSetting } from '../db.js';
import { DEFAULT_SETTINGS, type AppSettings } from '@tribot/shared';

// ===== 远程余额查询（尽力而为：失败不影响主流程，返回 ok:false）=====

async function fetchJson(url: string, apiKey: string, timeoutMs = 8000): Promise<{ ok: boolean; status?: number; data?: any; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 200);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** DeepSeek 官方余额接口（OpenAI 兼容 /user/balance） */
export async function checkDeepseek(apiKey: string) {
  const r = await fetchJson('https://api.deepseek.com/user/balance', apiKey);
  if (!r.ok) return { ok: false, detail: `HTTP ${r.status ?? r.detail}` };
  const info = r.data?.balance_infos?.find((b: any) => b.currency === 'CNY') ?? r.data?.balance_infos?.[0];
  return {
    ok: true,
    balance: info ? { amount: Number(info.total_balance), currency: info.currency ?? 'CNY' } : undefined,
    raw: r.data,
  };
}

/** 智谱 Coding Plan 用量（社区接口，格式可能随官方调整） */
export async function checkGlm(apiKey: string) {
  const r = await fetchJson('https://open.bigmodel.cn/api/monitor/usage/quota/limit', apiKey);
  return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status ?? r.detail}`, raw: r.data };
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function parseGlmUsage(raw: any): number | undefined {
  const t = raw?.data?.totalUsage?.totalTokensUsage ?? raw?.data?.totalTokensUsage;
  return typeof t === 'number' ? t : undefined;
}

/** 智谱真实 token 用量：model-usage 接口，按小时聚合 */
export async function checkGlmUsage(apiKey: string, hours: number) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  const url = `https://open.bigmodel.cn/api/monitor/usage/model-usage?startTime=${encodeURIComponent(fmtLocal(start))}&endTime=${encodeURIComponent(fmtLocal(end))}`;
  const r = await fetchJson(url, apiKey, 10_000);
  return {
    ok: r.ok,
    tokens: r.ok ? parseGlmUsage(r.data) : undefined,
    detail: r.ok ? undefined : `HTTP ${r.status ?? r.detail}`,
  };
}

/** MiniMax Token Plan 余量（社区接口；已知可能需要 cookie 认证，失败则依赖本地计量） */
export async function checkMinimax(apiKey: string) {
  const r = await fetchJson('https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains', apiKey);
  return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status ?? r.detail}`, raw: r.data };
}

// ===== 本地用量计量（最可靠的兜底）=====

export function recordUsage(
  db: Db,
  e: { provider: ProviderId; model: string; inputTokens: number; outputTokens: number; costEst: number; sessionId?: string },
): void {
  db.prepare(
    'INSERT INTO usage_events(ts, provider, model, input_tokens, output_tokens, cost_est, session_id) VALUES(?,?,?,?,?,?,?)',
  ).run(new Date().toISOString(), e.provider, e.model, e.inputTokens, e.outputTokens, e.costEst, e.sessionId ?? null);
}

export function meterAggregate(db: Db, provider: ProviderId, settings?: AppSettings) {
  const wStart = window5hStart().toISOString();
  const wkStart = weekStartShanghai();
  const q5 = db
    .prepare("SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS t FROM usage_events WHERE provider = ? AND ts >= ?")
    .get(provider, wStart) as { t: number };
  const qW = db
    .prepare("SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS t FROM usage_events WHERE provider = ? AND ts >= ?")
    .get(provider, wkStart) as { t: number };
  const s = settings ?? getSetting(db, 'settings', DEFAULT_SETTINGS);
  const limits = s.planLimits[provider] ?? {};
  return {
    window5hTokens: q5.t,
    weeklyTokens: qW.t,
    window5hLimit: limits.window5hTokens,
    weeklyLimit: limits.weeklyTokens,
  };
}

/** 从远程原始数据里推导 5h / 周窗口（各家用的是不同字段） */
export function deriveRemoteMeter(
  provider: ProviderId,
  raw: any,
): { window5hTokens?: number; window5hLimit?: number; weeklyTokens?: number; weeklyLimit?: number } | null {
  if (!raw) return null;
  if (provider === 'glm') {
    const limits = raw?.data?.limits;
    if (!Array.isArray(limits)) return null;
    // unit 3 = 5h 窗口，unit 6 = 周窗口（智谱 Coding Plan 的返回）
    const five = limits.find((x: any) => x?.type === 'CREDIT_LIMIT' && x?.unit === 3);
    const week = limits.find((x: any) => x?.type === 'CREDIT_LIMIT' && x?.unit === 6);
    const out: Record<string, number> = {};
    if (five?.usage) { out.window5hLimit = Number(five.usage); out.window5hTokens = Number(five.currentValue ?? 0); }
    if (week?.usage) { out.weeklyLimit = Number(week.usage); out.weeklyTokens = Number(week.currentValue ?? 0); }
    return Object.keys(out).length ? out : null;
  }
  if (provider === 'minimax') {
    const list = raw?.model_remains;
    if (!Array.isArray(list)) return null;
    const main = list.find((x: any) => x?.model_name === 'general') ?? list[0];
    if (!main) return null;
    const out: Record<string, number> = {};
    const fiveTotal = Number(main.current_interval_total_count ?? 0);
    if (fiveTotal > 0) {
      out.window5hLimit = fiveTotal;
      out.window5hTokens = Number(main.current_interval_usage_count ?? 0);
    }
    const weekTotal = Number(main.current_weekly_total_count ?? 0);
    if (weekTotal > 0) {
      out.weeklyLimit = weekTotal;
      out.weeklyTokens = Number(main.current_weekly_usage_count ?? 0);
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/** 汇总三家配额快照（远程 + 本地） */
export async function quotaDashboard(db: Db, env: EnvConfig, settings: AppSettings): Promise<QuotaSnapshot[]> {
  const now = new Date().toISOString();
  const out: QuotaSnapshot[] = [];
  const remotes: Array<[ProviderId, Promise<any>]> = [];
  for (const pid of Object.keys(PROVIDER_DEFS) as Array<keyof typeof PROVIDER_DEFS>) {
    const key = env.keys[pid];
    if (key) {
      if (pid === 'deepseek') remotes.push([pid, checkDeepseek(key)]);
      else if (pid === 'glm') remotes.push([pid, checkGlm(key)]);
      else remotes.push([pid, checkMinimax(key)]);
    }
  }
  const results = await Promise.allSettled(remotes.map(([, p]) => p));
  const remoteMap = new Map<ProviderId, any>();
  remotes.forEach(([pid], i) => {
    const r = results[i];
    remoteMap.set(pid, r.status === 'fulfilled' ? r.value : { ok: false, detail: String(r.reason) });
  });

  // 智谱另有 model-usage 接口，能给出真实 token 用量（quota/limit 里的 unit 是积分，不是 token）
  const glmKey = env.keys.glm;
  const [glm5h, glmWeek] = glmKey
    ? await Promise.allSettled([checkGlmUsage(glmKey, 5), checkGlmUsage(glmKey, 7 * 24)])
    : [null, null];

  for (const pid of Object.keys(PROVIDER_DEFS) as Array<keyof typeof PROVIDER_DEFS>) {
    const remote = remoteMap.get(pid);
    const snap: QuotaSnapshot = {
      provider: pid,
      billing: PROVIDER_DEFS[pid].billing,
      meter: meterAggregate(db, pid, settings),
      checkedAt: now,
    };
    if (remote) {
      snap.remote = { ok: !!remote.ok, detail: remote.detail, raw: remote.raw };
      if (remote.balance) snap.balance = remote.balance;
      const derived = deriveRemoteMeter(pid, remote.raw);
      if (derived) snap.meter = { ...snap.meter, ...derived };
      if (pid === 'glm') {
        snap.planLevel = remote.raw?.data?.level;
        if (glm5h?.status === 'fulfilled' && glm5h.value?.tokens != null) snap.usage5hTokens = glm5h.value.tokens;
        if (glmWeek?.status === 'fulfilled' && glmWeek.value?.tokens != null) snap.usageWeeklyTokens = glmWeek.value.tokens;
      }
      if (pid === 'minimax' && remote.ok && !snap.meter.window5hLimit) {
        snap.planNote = '套餐用量未返回';
      }
    } else {
      snap.remote = { ok: false, detail: env.keys[pid] ? '查询失败' : '未配置 API Key' };
    }
    if (pid === 'deepseek') snap.deepseekPeriod = deepseekPeriod();
    out.push(snap);
  }
  return out;
}

// 远程查询 60 秒缓存，避免仪表盘轮询打爆接口
let cache: { at: number; data: QuotaSnapshot[] } | undefined;

export async function quotaDashboardCached(db: Db, env: EnvConfig, settings: AppSettings): Promise<QuotaSnapshot[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const data = await quotaDashboard(db, env, settings);
  cache = { at: Date.now(), data };
  return data;
}
