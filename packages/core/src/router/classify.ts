import type { ModelTier } from '@tribot/shared';

// ===== 任务复杂度分类（确定性启发式，供自动路由使用）=====

export interface TaskClass {
  tier: ModelTier;
  reason: string;
}

const FLAGSHIP_PATTERNS = [
  /代码|编程|实现|重构|调试|debug|bug/i,
  /架构|设计|方案|规划|路线/i,
  /分析|对比|评测|研究|调研|拆解/i,
  /证明|推导|计算|数学|求解|逻辑/i,
  /优化|性能|排查|定位/i,
  /write|code|implement|refactor|debug|analyz|design|architect|prove|optimi/i,
];

const FAST_PATTERNS = [
  /^(你好|您好|hi|hello|嗨|在吗|在么)[!！。.~\s]*$/i,
  /^(谢谢|感谢|thanks|thank you|ok|好的|收到)[!！。.~\s]*$/i,
];

export function classifyTask(text: string, hasTaskCard = false): TaskClass {
  const t = text.trim();
  if (hasTaskCard) return { tier: 'flagship', reason: '任务卡派活，按旗舰档处理' };
  if (!t) return { tier: 'fast', reason: '空输入' };
  if (FAST_PATTERNS.some((re) => re.test(t))) return { tier: 'fast', reason: '寒暄/简短确认' };
  if (FLAGSHIP_PATTERNS.some((re) => re.test(t))) {
    return { tier: 'flagship', reason: '命中复杂任务关键词（代码/分析/规划等）' };
  }
  if (t.length <= 24 && !/[?？]/.test(t)) return { tier: 'fast', reason: '短文本且非疑问' };
  if (t.length >= 600) return { tier: 'flagship', reason: '长文本任务' };
  return { tier: 'balanced', reason: '常规问答' };
}

export const TIER_RANK: Record<ModelTier, number> = { fast: 1, balanced: 2, flagship: 3 };
