import type { ModelInfo, ProviderId, RoutingMode, TaskCard } from '@tribot/shared';
import type { ModelRegistry } from '../llm/registry.js';
import { classifyTask, TIER_RANK } from './classify.js';
import { isCooling } from './health.js';

// ===== 路由器：手动 / 自动 / 容错降级 / 同题对比 =====

export interface ProviderQuotaEntry {
  windowUsedTokens: number;
  weeklyUsedTokens: number;
  windowLimitTokens?: number;
  weeklyLimitTokens?: number;
}

export interface RouteContext {
  mode: RoutingMode;
  userText: string;
  taskCard?: TaskCard;
  manualModel?: string;
  compareModels?: string[];
  botModelPref?: string;
  keyedProviders: ProviderId[];
  quota: Partial<Record<ProviderId, ProviderQuotaEntry>>;
  deepseekPeriod: 'peak' | 'offpeak';
  /** provider → 计费方式（自定义供应商一般是按量） */
  billing?: Partial<Record<ProviderId, 'subscription' | 'payg'>>;
  /** 上一轮用的模型：会话内尽量粘住，保住前缀缓存、行为也稳定 */
  lastModel?: string;
  /** 用户只勾选了这些模型可用；null/undefined = 全部可用 */
  enabledModels?: string[] | null;
}

export interface RouteDecision {
  /** 有序降级链：主选在前，失败依次往后切 */
  chain: ModelInfo[];
  reason: string;
  /** compare 模式：并行对比的模型列表 */
  compare?: ModelInfo[];
}

export function subscriptionExhausted(entry?: ProviderQuotaEntry): boolean {
  if (!entry) return false;
  if (entry.windowLimitTokens && entry.windowUsedTokens >= entry.windowLimitTokens * 0.95) return true;
  if (entry.weeklyLimitTokens && entry.weeklyUsedTokens >= entry.weeklyLimitTokens * 0.95) return true;
  return false;
}

/** 单模型打分（越大越优先）。导出供单测。 */
export function scoreCandidate(
  m: ModelInfo,
  neededRank: number,
  ctx: RouteContext,
): number {
  const billing = ctx.billing?.[m.provider] ?? (m.provider === 'deepseek' ? 'payg' : 'subscription');
  const def = billing === 'payg';
  let score = 0;

  if (def) {
    // 按量付费：订阅都可用时低优先；DeepSeek 低谷半价加分
    score += 40;
    if (m.provider === 'deepseek' && ctx.deepseekPeriod === 'offpeak') score += 20;
    if (m.pricing) score -= Math.min(15, m.pricing.output / 2);
  } else {
    // 订阅制：边际成本≈0，优先用满
    score += 100;
    if (subscriptionExhausted(ctx.quota[m.provider])) score -= 200; // 本窗口接近耗尽 → 基本排除
  }

  const rank = TIER_RANK[m.tier];
  if (rank === neededRank) score += 12;
  else if (rank > neededRank) score -= (rank - neededRank) * 4; // 高射炮打蚊子，扣分省额度
  else score -= (neededRank - rank) * 10; // 档位不够，重扣

  // 会话粘性：沿用上一轮模型能吃到前缀缓存，也给一点点加分（只在档位刚好匹配时生效，
  // 避免为了粘性把简单任务也顶到旗舰档）
  if (ctx.lastModel && m.id === ctx.lastModel && rank === neededRank) score += 22;

  // 熔断：最近 3 分钟失败过的供应商直接靠后
  if (isCooling(m.provider)) score -= 150;

  return score;
}

function dedupeByProvider(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<ProviderId>();
  return models.filter((m) => {
    if (seen.has(m.provider)) return false;
    seen.add(m.provider);
    return true;
  });
}

export function route(registry: ModelRegistry, ctx: RouteContext): RouteDecision {
  const all = registry.allModels().filter((m) =>
    ctx.keyedProviders.includes(m.provider)
    && (!ctx.enabledModels || ctx.enabledModels.includes(m.id)),
  );
  const byId = (id: string) => all.find((m) => m.id === id);

  // Bot 锁定模型 → 视为手动
  const manualId = ctx.botModelPref ?? (ctx.mode === 'manual' ? ctx.manualModel : undefined);
  if (manualId) {
    const m = byId(manualId);
    if (m) {
      const fallbacks = all
        .filter((x) => x.id !== m.id)
        .sort((a, b) => scoreCandidate(b, TIER_RANK[m.tier], ctx) - scoreCandidate(a, TIER_RANK[m.tier], ctx));
      return {
        chain: [m, ...fallbacks],
        reason: ctx.botModelPref ? `Bot 指定模型：${m.label}` : `手动指定：${m.label}`,
      };
    }
    // 指定了但没 Key / 不存在：明确回退，而不是静默走自动
    const chain = [...all].sort((a, b) => scoreCandidate(b, 2, ctx) - scoreCandidate(a, 2, ctx));
    if (chain.length > 0) {
      return { chain, reason: `指定模型 ${manualId} 不可用（未配置 Key 或不存在），已回退到 ${chain[0].label}` };
    }
  }

  if (ctx.mode === 'compare') {
    // 显式选中的模型一律照单全收：不按档位过滤，也允许同一家出多个（「全部都能混用」）
    const wanted = (ctx.compareModels ?? []).map(byId).filter((x): x is ModelInfo => !!x);
    const picks = wanted.length > 0
      ? wanted.slice(0, 4)
      : dedupeByProvider(
        all.filter((m) => m.tier !== 'fast')
          .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]),
      ).slice(0, 3);
    const fallback = picks.length > 0 ? picks : all.slice(0, 3);
    return {
      chain: fallback.slice(0, 1),
      compare: fallback,
      reason: `同题对比：${fallback.map((m) => m.label).join(' / ')}`,
    };
  }

  if (ctx.mode === 'failover') {
    // 降级链不再「每家只留一个」：同家的不同档位也可以接力
    const chain = [...all].sort((a, b) => scoreCandidate(b, 2, ctx) - scoreCandidate(a, 2, ctx));
    return { chain, reason: `容错降级链：${chain.map((m) => m.label).join(' → ')}` };
  }

  // ===== 自动路由（默认）=====
  const cls = classifyTask(ctx.userText, !!ctx.taskCard);
  const neededRank = TIER_RANK[cls.tier];
  const scored = all
    .map((m) => ({ m, s: scoreCandidate(m, neededRank, ctx) }))
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    return { chain: [], reason: '没有可用的模型（检查 API Key 配置）' };
  }

  const best = scored[0].m;
  const chain = [best, ...dedupeByProvider(scored.slice(1).map((x) => x.m)).slice(0, 2)];

  const bits: string[] = [cls.reason];
  if (ctx.lastModel && best.id === ctx.lastModel) bits.push('沿用上一轮，前缀缓存更省');
  const cooling = [...new Set(all.filter((m) => isCooling(m.provider)).map((m) => m.provider))];
  if (cooling.length > 0) bits.push(`已避开冷却中的 ${cooling.join(' / ')}`);
  if (best.provider === 'deepseek') {
    bits.push(ctx.deepseekPeriod === 'offpeak' ? 'DeepSeek 低谷时段半价' : 'DeepSeek 按量');
  } else if (subscriptionExhausted(ctx.quota[best.provider])) {
    bits.push('订阅窗口已耗尽，仍强制使用（建议检查限额设置）');
  } else {
    bits.push('订阅额度优先');
  }
  return { chain, reason: `自动：${best.label}（${bits.join('；')}）` };
}
