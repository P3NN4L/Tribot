import { describe, expect, it } from 'vitest';
import { deriveRemoteMeter, parseGlmUsage } from '../src/quota/index.js';

describe('远程额度解析', () => {
  it('智谱：unit 3 = 5h，unit 6 = 周', () => {
    const raw = {
      data: {
        limits: [
          { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 12000, currentValue: 3400 },
          { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 60000, currentValue: 9000 },
        ],
      },
    };
    expect(deriveRemoteMeter('glm', raw)).toEqual({
      window5hLimit: 12000, window5hTokens: 3400,
      weeklyLimit: 60000, weeklyTokens: 9000,
    });
  });

  it('MiniMax：general 的区间/周计数', () => {
    const raw = {
      model_remains: [{
        model_name: 'general',
        current_interval_total_count: 4500,
        current_interval_usage_count: 1200,
        current_weekly_total_count: 30000,
        current_weekly_usage_count: 8000,
      }],
    };
    expect(deriveRemoteMeter('minimax', raw)).toEqual({
      window5hLimit: 4500, window5hTokens: 1200,
      weeklyLimit: 30000, weeklyTokens: 8000,
    });
  });

  it('缺字段时返回 null，不覆盖本地计量', () => {
    expect(deriveRemoteMeter('glm', { data: {} })).toBeNull();
    expect(deriveRemoteMeter('minimax', { model_remains: [] })).toBeNull();
    expect(deriveRemoteMeter('deepseek', { anything: 1 })).toBeNull();
  });
});

describe('智谱真实用量解析', () => {
  it('取 totalUsage.totalTokensUsage', () => {
    expect(parseGlmUsage({ data: { totalUsage: { totalTokensUsage: 15669597 } } })).toBe(15669597);
  });

  it('缺失时返回 undefined', () => {
    expect(parseGlmUsage({ data: {} })).toBeUndefined();
    expect(parseGlmUsage(null)).toBeUndefined();
  });
});
