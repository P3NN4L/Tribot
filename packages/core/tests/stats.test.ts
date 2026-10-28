import { describe, expect, it } from 'vitest';
import { extractCachedTokens, summarizeSessionUsage } from '../src/stats.js';

describe('会话用量统计', () => {
  it('汇总 token 与缓存命中率、输出速度', () => {
    const s = summarizeSessionUsage([
      { inputTokens: 1000, outputTokens: 200, cachedTokens: 600, latencyMs: 4000 },
      { inputTokens: 500, outputTokens: 100, cachedTokens: 300, latencyMs: 1000 },
    ]);
    expect(s.inputTokens).toBe(1500);
    expect(s.outputTokens).toBe(300);
    expect(s.cachedTokens).toBe(900);
    expect(s.cacheHitRate).toBeCloseTo(0.6);
    expect(s.tokensPerSec).toBeCloseTo(60); // 300 / 5s
    expect(s.messages).toBe(2);
  });

  it('缓存命中不会超过输入；空数据返回 0', () => {
    const s = summarizeSessionUsage([{ inputTokens: 100, outputTokens: 10, cachedTokens: 500, latencyMs: 0 }]);
    expect(s.cachedTokens).toBe(100);
    expect(s.cacheHitRate).toBe(1);
    expect(s.tokensPerSec).toBe(0);

    const empty = summarizeSessionUsage([]);
    expect(empty.inputTokens).toBe(0);
    expect(empty.cacheHitRate).toBe(0);
  });

  it('兼容三家缓存字段', () => {
    expect(extractCachedTokens({ prompt_cache_hit_tokens: 12 })).toBe(12);
    expect(extractCachedTokens({ prompt_tokens_details: { cached_tokens: 34 } })).toBe(34);
    expect(extractCachedTokens({ cache_read_input_tokens: 56 })).toBe(56);
    expect(extractCachedTokens({ cached_tokens: 78 })).toBe(78);
    expect(extractCachedTokens(undefined)).toBe(0);
  });
});
