import type { ThinkingEffort } from '@tribot/shared';
import {
  detectThinkingTrigger, raiseThinkingEffort, THINKING_EFFORT_RANK, type ThinkingTrigger,
} from '@tribot/shared';

// ===== 思考程度：不是 UI 装饰，它会实际改变系统提示、温度与工具轮次上限 =====

export interface ThinkingProfile {
  id: ThinkingEffort;
  label: string;
  hint: string;
  temperature: number;
  maxSteps: number;
  directive: string;
}

export const THINKING_PROFILES: Record<ThinkingEffort, ThinkingProfile> = {
  fast: {
    id: 'fast',
    label: '快速',
    hint: '一句话能说清就别展开',
    temperature: 0.2,
    maxSteps: 30,
    directive:
      '【思考程度：快速】直接给结论，最多 2 轮工具调用。不确定就直说不确定，不要长篇分析，不要罗列无关背景。',
  },
  standard: {
    id: 'standard',
    label: '标准',
    hint: '先拆解再执行，默认档位',
    temperature: 0.5,
    maxSteps: 100,
    directive: '',
  },
  deep: {
    id: 'deep',
    label: '深度',
    hint: '多步推理、多轮工具、给依据',
    temperature: 0.65,
    maxSteps: 300,
    directive:
      '【思考程度：深度】先在心里拆解问题并列计划，再动手；允许更多工具轮次做交叉验证；结论要给出依据、边界和风险，最后补一句可执行的下一步建议。',
  },
};

export function thinkingProfile(effort?: ThinkingEffort | null): ThinkingProfile {
  return THINKING_PROFILES[(effort ?? 'standard') as ThinkingEffort] ?? THINKING_PROFILES.standard;
}

export function normalizeThinking(effort?: string | null): ThinkingEffort {
  return effort === 'fast' || effort === 'deep' ? effort : 'standard';
}

// 触发词逻辑放在 @tribot/shared，渲染层要用来做输入时的即时提示
export function raiseEffort(base: ThinkingEffort, target: ThinkingEffort): ThinkingEffort {
  return raiseThinkingEffort(base, target);
}

export { detectThinkingTrigger, THINKING_EFFORT_RANK };
export type { ThinkingTrigger };
