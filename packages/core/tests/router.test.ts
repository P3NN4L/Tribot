import { describe, expect, it } from 'vitest';
import { classifyTask } from '../src/router/classify.js';
import { route, scoreCandidate, subscriptionExhausted } from '../src/router/index.js';
import { isCooling, recordRouteFailure, resetRouteHealth } from '../src/router/health.js';
import { ModelRegistry, DEFAULT_MODELS } from '../src/llm/registry.js';
import { deepseekPeriod, shanghaiClock, weekStartShanghai } from '../src/quota/clock.js';
import type { RouteContext } from '../src/router/index.js';

// ===== 任务分类 =====
describe('classifyTask', () => {
  it('寒暄走 fast', () => {
    expect(classifyTask('你好').tier).toBe('fast');
    expect(classifyTask('hello!').tier).toBe('fast');
    expect(classifyTask('谢谢').tier).toBe('fast');
  });
  it('代码/分析类走 flagship', () => {
    expect(classifyTask('帮我重构这段代码').tier).toBe('flagship');
    expect(classifyTask('分析一下这两个方案的优劣').tier).toBe('flagship');
    expect(classifyTask('debug 一下为什么崩溃').tier).toBe('flagship');
  });
  it('普通问题走 balanced', () => {
    expect(classifyTask('法国的首都是哪里？').tier).toBe('balanced');
  });
  it('任务卡强制 flagship', () => {
    expect(classifyTask('hi', true).tier).toBe('flagship');
  });
});

// ===== 峰谷时钟 =====
describe('shanghaiClock / deepseekPeriod', () => {
  it('周六全天低谷', () => {
    // 2026-10-24 是周六 15:00 北京时间 = 07:00 UTC
    expect(deepseekPeriod(new Date('2026-10-24T07:00:00Z'))).toBe('offpeak');
  });
  it('工作日 15:00 高峰（14:00-18:00）', () => {
    // 2026-10-21 是周三
    expect(deepseekPeriod(new Date('2026-10-21T07:00:00Z'))).toBe('peak');
  });
  it('工作日 13:00 午间低谷', () => {
    expect(deepseekPeriod(new Date('2026-10-21T05:00:00Z'))).toBe('offpeak');
  });
  it('工作日 09:30 高峰', () => {
    expect(deepseekPeriod(new Date('2026-10-21T01:30:00Z'))).toBe('peak');
  });
  it('周一起点正确', () => {
    // 2026-10-25 是周日 → 应退回 2026-10-19（周一）
    const s = weekStartShanghai(new Date('2026-10-25T04:00:00Z'));
    expect(s.startsWith('2026-10-19')).toBe(true);
  });
  it('shanghaiClock 基本字段', () => {
    const c = shanghaiClock(new Date('2026-10-21T01:30:00Z'));
    expect(c.weekday).toBe(3); // 周三
    expect(c.minutes).toBe(9 * 60 + 30);
  });
});

// ===== 路由策略 =====
function makeCtx(partial: Partial<RouteContext> = {}): RouteContext {
  return {
    mode: 'auto',
    userText: '常规问题',
    keyedProviders: ['glm', 'minimax', 'deepseek'],
    quota: {},
    deepseekPeriod: 'offpeak',
    ...partial,
  };
}

const registry = new ModelRegistry({ root: '', dataDir: '', port: 1, packaged: false, keys: {} });

describe('route', () => {
  it('简单任务优先订阅制的低档模型（省钱）', () => {
    const d = route(registry, makeCtx({ userText: '你好' }));
    expect(d.chain[0].tier).toBe('fast');
    expect(d.chain[0].provider).not.toBe('deepseek');
  });

  it('复杂任务优先订阅制旗舰', () => {
    const d = route(registry, makeCtx({ userText: '帮我分析并重构这段代码' }));
    expect(d.chain[0].tier).toBe('flagship');
    expect(['glm', 'minimax']).toContain(d.chain[0].provider);
  });

  it('只允许用户勾选的模型参与路由', () => {
    const d = route(registry, makeCtx({
      userText: '帮我分析并重构这段代码',
      enabledModels: ['deepseek-reasoner'],
    }));
    expect(d.chain.length).toBeGreaterThan(0);
    expect(d.chain.every((m) => m.id === 'deepseek-reasoner')).toBe(true);
  });

  it('订阅窗口耗尽时切到 DeepSeek', () => {
    const d = route(registry, makeCtx({
      userText: '复杂分析任务',
      quota: {
        glm: { windowUsedTokens: 980, weeklyUsedTokens: 5000, windowLimitTokens: 1000 },
        minimax: { windowUsedTokens: 980, weeklyUsedTokens: 5000, windowLimitTokens: 1000 },
      },
    }));
    expect(d.chain[0].provider).toBe('deepseek');
  });

  it('低谷时段 DeepSeek 加分', () => {
    const glm = DEFAULT_MODELS.find((m) => m.id === 'glm-5.2')!;
    const ds = DEFAULT_MODELS.find((m) => m.id === 'deepseek-chat')!;
    const sPeak = scoreCandidate(ds, 2, makeCtx({ deepseekPeriod: 'peak' }));
    const sOff = scoreCandidate(ds, 2, makeCtx({ deepseekPeriod: 'offpeak' }));
    expect(sOff).toBeGreaterThan(sPeak);
    expect(scoreCandidate(glm, 2, makeCtx())).toBeGreaterThan(sOff); // 订阅仍然优先
  });

  it('手动指定模型优先于自动路由', () => {
    const d = route(registry, makeCtx({ mode: 'manual', manualModel: 'deepseek-chat', userText: '你好' }));
    expect(d.chain[0].id).toBe('deepseek-chat');
  });

  it('Bot 锁定模型优先', () => {
    const d = route(registry, makeCtx({ botModelPref: 'MiniMax-M2', userText: '你好' }));
    expect(d.chain[0].id).toBe('MiniMax-M2');
  });

  it('compare 模式返回每家一个模型', () => {
    const d = route(registry, makeCtx({ mode: 'compare' }));
    expect(d.compare!.length).toBe(3);
    const providers = new Set(d.compare!.map((m) => m.provider));
    expect(providers.size).toBe(3);
  });

  it('compare 显式选择可任意混搭：fast 档、同一家多个都行', () => {
    const d = route(registry, makeCtx({
      mode: 'compare',
      compareModels: ['glm-5.3-flash', 'glm-5.3', 'deepseek-chat'],
    }));
    expect(d.compare!.map((m) => m.id)).toEqual(['glm-5.3-flash', 'glm-5.3', 'deepseek-chat']);
    expect(new Set(d.compare!.map((m) => m.provider)).size).toBe(2); // 允许同一家出两个
  });

  it('compare 最多 4 个模型', () => {
    const d = route(registry, makeCtx({
      mode: 'compare',
      compareModels: ['glm-5.3', 'glm-5.3-flash', 'MiniMax-M3', 'deepseek-chat', 'deepseek-reasoner'],
    }));
    expect(d.compare!.length).toBe(4);
  });

  it('手动指定了没配 Key 的模型：明确回退而不是静默', () => {
    const d = route(registry, makeCtx({ mode: 'manual', manualModel: 'glm-5.3', keyedProviders: ['deepseek'] }));
    expect(d.chain.every((m) => m.provider === 'deepseek')).toBe(true);
    expect(d.reason).toContain('不可用');
  });

  it('failover 同一家的不同档位也能接力', () => {
    const d = route(registry, makeCtx({ mode: 'failover', keyedProviders: ['glm'] }));
    expect(d.chain.length).toBeGreaterThan(1);
    expect(d.chain.every((m) => m.provider === 'glm')).toBe(true);
  });

  it('自定义供应商（Kimi）的模型能参与手动与对比', () => {
    const customReg = new ModelRegistry(
      { root: '', dataDir: '', port: 1, packaged: false, keys: { kimi: 'sk-kimi' } } as any,
      {
        customProviders: [{
          id: 'kimi', label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', billing: 'payg',
          models: [
            { id: 'kimi-k2', label: 'Kimi K2', tier: 'flagship' },
            { id: 'kimi-k2-turbo', label: 'Kimi K2 Turbo', tier: 'fast' },
          ],
          createdAt: new Date().toISOString(),
        }],
      },
    );
    const ctx = makeCtx({
      keyedProviders: ['kimi', 'deepseek'],
      billing: { kimi: 'payg', deepseek: 'payg' },
    });
    const manual = route(customReg, { ...ctx, mode: 'manual', manualModel: 'kimi-k2' });
    expect(manual.chain[0].id).toBe('kimi-k2');

    const compare = route(customReg, { ...ctx, mode: 'compare', compareModels: ['kimi-k2', 'deepseek-chat'] });
    expect(compare.compare!.map((m) => m.id)).toEqual(['kimi-k2', 'deepseek-chat']);
  });

  it('failover 模式链跨 provider', () => {
    const d = route(registry, makeCtx({ mode: 'failover' }));
    expect(new Set(d.chain.map((m) => m.provider)).size).toBe(3);
  });

  it('失败熔断：冷却中的供应商降 150 分，并在理由里写明', () => {
    resetRouteHealth();
    const glm = DEFAULT_MODELS.find((m) => m.id === 'glm-5.2')!;
    const before = scoreCandidate(glm, 2, makeCtx());
    recordRouteFailure('glm');
    expect(isCooling('glm')).toBe(true);
    const after = scoreCandidate(glm, 2, makeCtx());
    expect(after).toBe(before - 150);
    const d = route(registry, makeCtx({ userText: '常规问题' }));
    expect(d.reason).toContain('冷却');
    resetRouteHealth();
  });

  it('会话粘性：上一轮模型在同等价格档里优先（保住前缀缓存）', () => {
    resetRouteHealth();
    const customReg = new ModelRegistry(
      { root: '', dataDir: '', port: 1, packaged: false, keys: { kimi: 'k', deepseek: 'd' } } as any,
      {
        customProviders: [{
          id: 'kimi', label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', billing: 'payg',
          models: [{ id: 'kimi-k2', label: 'Kimi K2', tier: 'balanced' }],
          createdAt: new Date().toISOString(),
        }],
      },
    );
    const ctx = makeCtx({
      keyedProviders: ['kimi', 'deepseek'],
      billing: { kimi: 'payg', deepseek: 'payg' },
      userText: '法国的首都是哪里？',
    });
    // 不带粘性：DeepSeek 低谷有加分，通常胜出
    const fresh = route(customReg, { ...ctx });
    expect(fresh.chain[0].id).toBe('deepseek-chat');
    // 上一轮用了 Kimi：粘性加分让它留在 Kimi
    const sticky = route(customReg, { ...ctx, lastModel: 'kimi-k2' });
    expect(sticky.chain[0].id).toBe('kimi-k2');
    expect(sticky.reason).toContain('沿用上一轮');
  });

  it('只配了一家 key 时自动收敛', () => {
    const d = route(registry, makeCtx({ keyedProviders: ['deepseek'], userText: '复杂分析任务' }));
    expect(d.chain.every((m) => m.provider === 'deepseek')).toBe(true);
  });

  it('subscriptionExhausted 阈值判断', () => {
    expect(subscriptionExhausted({ windowUsedTokens: 950, weeklyUsedTokens: 0, windowLimitTokens: 1000 })).toBe(true);
    expect(subscriptionExhausted({ windowUsedTokens: 500, weeklyUsedTokens: 0, windowLimitTokens: 1000 })).toBe(false);
  });
});
