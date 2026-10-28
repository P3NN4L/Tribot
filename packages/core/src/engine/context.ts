import type { AppSettings, Bot, ContextInsight, ContextPart, ModelTier, Session, TaskCard } from '@tribot/shared';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import type { ModelRegistry } from '../llm/registry.js';
import { getBot, listMessages } from '../db.js';
import { chatStream } from '../llm/client.js';
import { toolSchemas } from '../tools/index.js';
import { maybeSummarize, resolveWorkspaces, selectRecentHistory, systemSections } from './memory.js';
import { sessionSaveStats } from './compress.js';

// ===== 上下文洞察：把「这次到底发了什么给模型」算清楚 =====

export interface ContextDeps {
  db: Db;
  env: EnvConfig;
  registry: ModelRegistry;
  getSettings: () => AppSettings;
}

/** 中文按 1 字 ≈ 1 token，英文/代码按 3.5 字符 ≈ 1 token 估 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) ?? []).length;
  const rest = Math.max(0, text.length - cjk);
  return Math.ceil(cjk + rest / 3.5);
}

// 统一 1M 上下文预算（模型实际窗口因供应商而异，这里按上限展示与压缩节奏）
const CONTEXT_BUDGET = 1_000_000;
const TIER_BUDGET: Record<ModelTier, number> = {
  flagship: CONTEXT_BUDGET,
  balanced: CONTEXT_BUDGET,
  fast: CONTEXT_BUDGET,
};

function budgetFor(registry: ModelRegistry, modelId?: string): { budget: number; tier: ModelTier } {
  const m = modelId ? registry.findModel(modelId) : undefined;
  const tier = m?.tier ?? 'balanced';
  return { budget: TIER_BUDGET[tier], tier };
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function buildContextInsight(
  deps: ContextDeps,
  input: { sessionId: string; botId?: string; model?: string; taskCard?: TaskCard },
): ContextInsight {
  const { db, env, registry } = deps;
  const settings = deps.getSettings();
  const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as any;
  if (!sessionRow) throw new Error('session 不存在');
  const session: Session = {
    id: sessionRow.id, title: sessionRow.title, type: sessionRow.type,
    createdAt: sessionRow.created_at, updatedAt: sessionRow.updated_at,
    meta: JSON.parse(sessionRow.meta || '{}'),
  };
  const botId = input.botId ?? db.prepare('SELECT id FROM bots ORDER BY created_at ASC LIMIT 1').get()?.id;
  const bot: Bot | undefined = botId ? getBot(db, botId as string) : undefined;
  if (!bot) throw new Error('Bot 不存在');

  const skillNames = (db.prepare('SELECT name FROM skills WHERE enabled = 1 ORDER BY name LIMIT 30').all() as any[])
    .map((r) => r.name as string);
  const workspaceDirs = resolveWorkspaces(env.dataDir, bot.name, session.meta as any);
  const workspaceDir = workspaceDirs[0];
  const sections = systemSections({
    bot, session, taskCard: input.taskCard, settings, skillNames, workspaceDir, workspaceDirs,
  });
  const history = listMessages(db, session.id)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0);
  const { recent, omitted } = selectRecentHistory(history);
  const saves = sessionSaveStats(db, session.id);
  const savedTokens = Math.ceil(saves.savedChars / 3);

  const systemTokens = estimateTokens(`${sections.base}\n\n${sections.env}`);
  const skillTokens = estimateTokens(sections.skills);
  const taskTokens = estimateTokens(sections.task);
  const summaryTokens = estimateTokens(sections.summary);
  const toolTokens = estimateTokens(JSON.stringify(toolSchemas(bot)));
  const historyTokens = recent.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
  const omittedTokens = history.slice(0, omitted).reduce((n, m) => n + estimateTokens(m.content), 0);

  const allParts: ContextPart[] = [
    { key: 'system', label: '系统提示（Bot 职责 + 环境）', tokens: systemTokens, detail: `${bot.name} 的人设与运行约束` },
    { key: 'tools', label: '工具 Schema', tokens: toolTokens, detail: `${toolSchemas(bot).length} 个工具的函数签名` },
    { key: 'skills', label: '技能清单', tokens: skillTokens, detail: `${skillNames.length} 个可用技能（只发名字，正文按需加载）` },
    { key: 'task', label: '任务卡', tokens: taskTokens, detail: sections.task ? '五要素任务卡' : '本次没有任务卡' },
    { key: 'summary', label: '历史摘要', tokens: summaryTokens, detail: sections.summary ? '早期对话已压缩成摘要' : '尚未压缩' },
    { key: 'history', label: `近期对话（${recent.length} 条）`, tokens: historyTokens, detail: `共 ${history.length} 条，按最近 ${recent.length} 条发送` },
    { key: 'omitted', label: `未发送（${omitted} 条）`, tokens: omittedTokens, detail: '超出近期窗口，靠摘要兜底' },
    { key: 'saved', label: `压缩省下（${saves.count} 次）`, tokens: savedTokens, detail: '长工具输出落盘，只回填头尾，可 expand_output 读回' },
  ];
  const parts = allParts.filter((p) => p.tokens > 0 || p.key === 'summary' || p.key === 'omitted' || p.key === 'saved');

  const used = systemTokens + skillTokens + taskTokens + summaryTokens + toolTokens + historyTokens;
  const { budget } = budgetFor(registry, input.model ?? bot.modelPref);
  const pct = budget > 0 ? used / budget : 0;

  // 省了多少：工具输出压缩 + 摘要压缩，按当前模型输入价折成钱
  const fullHistoryTokens = history.reduce((n, m) => n + estimateTokens(m.content), 0);
  const summarySaved = Math.max(0, fullHistoryTokens - summaryTokens - historyTokens);
  const totalSaved = savedTokens + summarySaved;
  const pricePerMTok = registry.findModel(input.model ?? bot.modelPref ?? '')?.pricing?.input ?? 0.5;
  const savings = {
    spillTokens: savedTokens,
    summaryTokens: summarySaved,
    totalTokens: totalSaved,
    costSavedYuan: Math.round((totalSaved / 1e6) * pricePerMTok * 10000) / 10000,
    pricePerMTok,
  };

  const suggestions: string[] = [];
  if (pct > 0.75) suggestions.push(`已占用 ${Math.round(pct * 100)}%，点「压缩上下文」把早期对话归档成摘要再继续。`);
  if (omitted > 0) suggestions.push(`有 ${omitted} 条更早的消息没发出去（约 ${fmtK(omittedTokens)} tokens），关键结论要能落到摘要里。`);
  if (!sections.summary && history.length > 20) suggestions.push('对话已经不短了，压缩一次能明显降低每轮成本与串味。');
  if (skillNames.length > 15) suggestions.push(`可用技能 ${skillNames.length} 个，清单本身也在吃 token；不用的到「技能库」关掉。`);
  if (saves.count > 0) suggestions.push(`已压缩 ${saves.count} 次长工具输出，省下约 ${fmtK(savedTokens)} tokens；要看细节让 Bot 调 expand_output。`);
  if (pct <= 0.4) suggestions.push('上下文还很宽裕，可以放心多轮追问。');
  if (suggestions.length === 0) suggestions.push('上下文结构健康，无需调整。');

  return {
    sessionId: session.id,
    botId: bot.id,
    botName: bot.name,
    model: input.model ?? bot.modelPref,
    budget,
    used,
    parts,
    historyTotal: history.length,
    historyIncluded: recent.length,
    skills: skillNames.length,
    tools: toolSchemas(bot).length,
    compactions: saves.count,
    savedTokens,
    savings,
    summarized: !!sections.summary,
    summaryChars: (session.meta?.summary as string | undefined)?.length ?? 0,
    suggestions,
    updatedAt: new Date().toISOString(),
  };
}

/** 手动压缩：拿最便宜的可用模型把早期对话压成摘要 */
export async function compactSession(deps: ContextDeps, sessionId: string): Promise<{ ok: boolean; note: string }> {
  const { db, env, registry } = deps;
  const keyed = registry.allProviderIds().filter((p) => !!env.keys[p]);
  if (keyed.length === 0) return { ok: false, note: '没有可用的 API Key，无法生成摘要' };
  const fast = registry.allModels().find((m) => m.tier === 'fast' && keyed.includes(m.provider))
    ?? registry.allModels().find((m) => keyed.includes(m.provider));
  if (!fast) return { ok: false, note: '没有可用模型' };
  const ok = await maybeSummarize({
    db,
    sessionId,
    force: true,
    callCheap: async (prompt) => {
      const r = await chatStream({
        provider: fast.provider,
        baseURL: registry.baseURL(fast.provider),
        apiKey: registry.apiKey(env, fast.provider)!,
        model: fast.id,
        messages: [{ role: 'user', content: prompt }],
      });
      return r.content;
    },
  });
  return ok
    ? { ok: true, note: `已压缩，摘要 ${fast.label}` }
    : { ok: false, note: '消息太少，或摘要模型没有返回内容' };
}
