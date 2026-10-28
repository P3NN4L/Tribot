import { describe, expect, it } from 'vitest';
import { detectThinkingTrigger, raiseThinkingEffort } from '@tribot/shared';
import { THINKING_PROFILES, normalizeThinking, thinkingProfile } from '../src/engine/thinking.js';

// ===== 思考触发词：Claude Code 的 think / think hard / ultrathink =====

describe('思考触发词', () => {
  it('英文三档：think → standard，think hard / ultrathink → deep', () => {
    expect(detectThinkingTrigger('think about this')?.effort).toBe('standard');
    expect(detectThinkingTrigger('please think harder')?.effort).toBe('deep');
    expect(detectThinkingTrigger('think hard about the migration')?.effort).toBe('deep');
    expect(detectThinkingTrigger('ultrathink this design')?.effort).toBe('deep');
  });

  it('中文触发词同样识别', () => {
    expect(detectThinkingTrigger('深入思考一下这个方案')?.effort).toBe('deep');
    expect(detectThinkingTrigger('深度思考：上下文怎么压缩')?.effort).toBe('deep');
    expect(detectThinkingTrigger('你仔细想一下')?.effort).toBe('deep');
    expect(detectThinkingTrigger('极限思考这个问题')?.effort).toBe('deep');
    expect(detectThinkingTrigger('先想一想')?.effort).toBe('standard');
  });

  it('没有触发词返回 null', () => {
    expect(detectThinkingTrigger('帮我把这个文件改成 JSON')).toBeNull();
    expect(detectThinkingTrigger('')).toBeNull();
  });

  it('只升不降：手动选了深度不会被 think 降回标准', () => {
    expect(raiseThinkingEffort('deep', 'standard')).toBe('deep');
    expect(raiseThinkingEffort('fast', 'standard')).toBe('standard');
    expect(raiseThinkingEffort('standard', 'deep')).toBe('deep');
  });

  it('三档的实际参数（温度 / 工具轮次）', () => {
    expect(THINKING_PROFILES.fast).toMatchObject({ temperature: 0.2, maxSteps: 30 });
    expect(THINKING_PROFILES.standard).toMatchObject({ temperature: 0.5, maxSteps: 100 });
    expect(THINKING_PROFILES.deep).toMatchObject({ temperature: 0.65, maxSteps: 300 });
    expect(thinkingProfile('deep').directive).toContain('深度');
    expect(normalizeThinking('nonsense')).toBe('standard');
  });
});
