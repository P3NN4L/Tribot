// ===== 会话级用量统计：token 速度 / 缓存命中率 =====

export interface SessionUsageRow {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  latencyMs?: number | null;
}

export interface SessionUsageStats {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** 缓存命中率 = 命中的输入 token / 输入 token */
  cacheHitRate: number;
  /** 输出 token / 生成耗时（秒） */
  tokensPerSec: number;
  totalLatencyMs: number;
  messages: number;
}

/** 兼容各家缓存字段：DeepSeek / OpenAI 兼容 / Anthropic 风格 */
export function extractCachedTokens(usage: any): number {
  if (!usage || typeof usage !== 'object') return 0;
  const v = usage.prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
    ?? usage.cache_read_input_tokens
    ?? usage.cached_tokens
    ?? 0;
  return Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
}

export function summarizeSessionUsage(rows: SessionUsageRow[]): SessionUsageStats {
  let input = 0;
  let output = 0;
  let cached = 0;
  let latency = 0;
  let messages = 0;
  for (const r of rows) {
    const i = Number(r.inputTokens) || 0;
    const o = Number(r.outputTokens) || 0;
    const c = Number(r.cachedTokens) || 0;
    const l = Number(r.latencyMs) || 0;
    if (i === 0 && o === 0) continue;
    messages += 1;
    input += i;
    output += o;
    cached += Math.min(c, i); // 命中不可能超过输入
    latency += l;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    cacheHitRate: input > 0 ? cached / input : 0,
    tokensPerSec: latency > 0 ? output / (latency / 1000) : 0,
    totalLatencyMs: latency,
    messages,
  };
}
