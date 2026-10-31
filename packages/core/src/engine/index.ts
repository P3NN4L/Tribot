import type {
  AppSettings, Bot, ChatMessage, ProviderId, RoutingMode, StreamEvent, TaskCard, ThinkingEffort,
} from '@tribot/shared';
import { getBot, getSetting, insertMessage, listBots } from '../db.js';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import { DEFAULT_SETTINGS } from '@tribot/shared';
import { chatStream, isFailoverWorthy, type LLMMessage } from '../llm/client.js';
import type { ModelRegistry } from '../llm/registry.js';
import { route } from '../router/index.js';
import { TIER_RANK } from '../router/classify.js';
import { recordRouteFailure, recordRouteSuccess } from '../router/health.js';
import { meterAggregate, recordUsage } from '../quota/index.js';
import { deepseekPeriod } from '../quota/clock.js';
import { ApprovalService } from '../tools/approval.js';
import { findTool, toolSchemas, type ToolContext } from '../tools/index.js';
import { buildMessages, ensureWorkspace, maybeSummarize, resolveWorkspaces } from './memory.js';
import { missingContract, roleForBotName } from '../bots/roles.js';
import { normalizeThinking, thinkingProfile, detectThinkingTrigger, raiseEffort } from './thinking.js';
import { packToolOutput } from './compress.js';

// ===== Agent 引擎：路由 → 循环调模型 → 执行工具（含审批）→ 交付 =====

export interface EngineContext {
  db: Db;
  env: EnvConfig;
  registry: ModelRegistry;
  getSettings: () => AppSettings;
  saveSettings?: (settings: AppSettings) => void;
}

export interface RunOptions {
  sessionId: string;
  botId: string;
  userText: string;
  taskCard?: TaskCard;
  mode?: RoutingMode;
  manualModel?: string;
  compareModels?: string[];
  thinking?: ThinkingEffort;
  /** 计划模式：先出计划、等用户批准再执行 */
  plan?: boolean;
  emit: (e: StreamEvent) => void;
  signal?: AbortSignal;
  /** 总管分派的子任务不再落用户消息 */
  persistUser?: boolean;
  depth?: number;
}

function costEstimate(provider: ProviderId, model: string, registry: ModelRegistry, input: number, output: number): number {
  if (provider !== 'deepseek') return 0; // 订阅制边际成本记 0
  const m = registry.findModel(model);
  if (!m?.pricing) return 0;
  const factor = deepseekPeriod() === 'offpeak' ? 0.5 : 1;
  return ((input / 1e6) * m.pricing.input + (output / 1e6) * m.pricing.output) * factor;
}

export async function runChat(ctx: EngineContext, opts: RunOptions): Promise<ChatMessage> {
  const { db, env, registry } = ctx;
  const settings = ctx.getSettings();
  const bot = getBot(db, opts.botId);
  if (!bot) throw new Error(`Bot 不存在：${opts.botId}`);
  const depth = opts.depth ?? 0;
  // 工作目录：会话（任务）自己指定的文件夹优先，没指定才用 Bot 默认工作区
  const sessionMetaRow = db.prepare('SELECT meta FROM sessions WHERE id = ?').get(opts.sessionId) as { meta?: string } | undefined;
  const sessionMeta: Record<string, any> = (() => {
    try { return JSON.parse(sessionMetaRow?.meta || '{}'); } catch { return {}; }
  })();
  const workspaceDirs = resolveWorkspaces(env.dataDir, bot.name, sessionMeta);
  const workspaceDir = workspaceDirs[0];
  // 思考程度：请求里带的 > Bot 自己的偏好 > 全局默认；再叠加「触发词」自动升档
  const baseEffort = normalizeThinking(opts.thinking ?? bot.thinking ?? settings.thinking?.default);
  const trigger = detectThinkingTrigger(opts.userText);
  const effort = trigger ? raiseEffort(baseEffort, trigger.effort) : baseEffort;
  const profile = thinkingProfile(effort);
  if (trigger && effort !== baseEffort) {
    opts.emit({
      type: 'notice', level: 'info',
      message: `检测到「${trigger.label}」，思考档位自动升到「${profile.label}」`,
    });
  }

  // 1. 落用户消息
  if (opts.persistUser !== false && opts.userText.trim()) {
    insertMessage(db, { sessionId: opts.sessionId, role: 'user', content: opts.userText });
  }

  const emit = opts.emit;
  emit({ type: 'start', sessionId: opts.sessionId, botId: bot.id, botName: bot.name });

  // 2. 路由
  const keyedProviders = registry.allProviderIds()
    .filter((p) => !!env.keys[p] && registry.modelsOfProvider(p).length > 0);
  if (keyedProviders.length === 0) {
    const msg = '没有配置任何 API Key，请在项目根目录的 .env 里填写（参考 .env.example）';
    emit({ type: 'error', message: msg });
    const m = insertMessage(db, { sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: bot.name, content: msg });
    emit({ type: 'message_done', message: m });
    emit({ type: 'done' });
    return m;
  }
  const quotaCtx = Object.fromEntries(
    keyedProviders.map((p) => [p, (() => {
      const agg = meterAggregate(db, p, settings);
      return {
        windowUsedTokens: agg.window5hTokens,
        weeklyUsedTokens: agg.weeklyTokens,
        windowLimitTokens: agg.window5hLimit,
        weeklyLimitTokens: agg.weeklyLimit,
      };
    })()]),
  );
  // 会话粘性：查这个会话上一轮实际用了哪个模型
  const lastModelRow = db
    .prepare("SELECT model FROM messages WHERE session_id = ? AND role = 'assistant' AND model IS NOT NULL ORDER BY created_at DESC LIMIT 1")
    .get(opts.sessionId) as { model?: string } | undefined;

  const decision = route(registry, {
    mode: opts.mode ?? settings.routing.mode,
    userText: opts.userText,
    taskCard: opts.taskCard,
    manualModel: opts.manualModel ?? settings.routing.manualModel,
    compareModels: opts.compareModels ?? settings.routing.compareModels,
    botModelPref: bot.modelPref,
    keyedProviders,
    quota: quotaCtx,
    deepseekPeriod: deepseekPeriod(),
    billing: Object.fromEntries(registry.providerInfos(env).map((p) => [p.id, p.billing])),
    lastModel: lastModelRow?.model,
    enabledModels: settings.models?.enabled ?? null,
    // B. 管家/研究员档位上限 balanced（rank≤1）；总管/工程师/审稿人不锁
    maxTierRank: bot.name === '管家' || bot.name === '研究员' ? TIER_RANK['balanced'] : undefined,
  });

  // 3. 同题对比：并行单轮，不跑工具
  if (decision.compare && decision.compare.length > 1) {
    const results = await Promise.allSettled(
      decision.compare.map(async (m, i) => {
        emit({ type: 'route', provider: m.provider, model: m.id, reason: `对比 ${i + 1}/${decision.compare!.length}`, attempt: i });
        const r = await chatStream({
          provider: m.provider,
          baseURL: registry.baseURL(m.provider),
          apiKey: registry.apiKey(env, m.provider)!,
          model: m.id,
          messages: [
            { role: 'system', content: `${bot.systemPrompt}${profile.directive ? `\n\n${profile.directive}` : ''}` },
            { role: 'user', content: opts.userText },
          ],
          temperature: profile.temperature,
          thinking: m.provider === 'glm' ? (profile.id === 'deep' ? 'enabled' : 'disabled') : undefined,
          signal: opts.signal,
        });
        recordUsage(db, {
          provider: m.provider, model: m.id,
          inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens,
          costEst: costEstimate(m.provider, m.id, registry, r.usage.inputTokens, r.usage.outputTokens),
          sessionId: opts.sessionId,
        });
        const message = insertMessage(db, {
          sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: `${bot.name} · ${m.label}`,
          content: r.content || '（无内容）', provider: m.provider, model: m.id,
          routeReason: `同题对比 第 ${i + 1} 栏`, compareIndex: i,
          thinking: effort,
          usage: r.usage,
        });
        emit({ type: 'message_done', message });
        return message;
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) emit({ type: 'error', message: `${failed} 个模型对比失败（已跳过）` });
    emit({ type: 'done' });
    const last = results.filter((r): r is PromiseFulfilledResult<ChatMessage> => r.status === 'fulfilled').at(-1);
    return last?.value ?? insertMessage(db, { sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: bot.name, content: '（对比全部失败）' });
  }

  // 4. 主循环（含降级链）
  // A. 技能白名单：管家只留巡检类，研究员只留调研类，其余全部（总管不裁）
  const ROLE_SKILL_FILTER: Record<string, RegExp> = {
    管家: /巡检|检查|监控|清理|备份|巡检/,
    研究员: /调研|搜索|检索|引用|来源|研究/,
  };
  const roleFilter = ROLE_SKILL_FILTER[bot.name];
  const skillNames = (db.prepare('SELECT name FROM skills WHERE enabled = 1 ORDER BY name LIMIT 30').all() as any[])
    .map((r) => r.name as string)
    .filter((n) => !roleFilter || roleFilter.test(n));
  const approvals = new ApprovalService(
    db,
    { getSettings: ctx.getSettings, saveSettings: ctx.saveSettings },
    emit,
  );

  const toolCtx: ToolContext = {
    db, env, settings, bot,
    sessionId: opts.sessionId,
    workspaceDir,
    workspaceDirs,
    emit,
    planMode: !!opts.plan,
    approvals,
    dispatch: depth < 2 ? async (botName, instruction) => {
      const target = listBots(db).find((b) => b.name === botName || b.name.includes(botName));
      if (!target) return `没有叫 "${botName}" 的 Bot。可用的有：${listBots(db).map((b) => b.name).join('、')}`;
      emit({ type: 'assign', fromBot: bot.name, toBot: target.name, instruction });
      const sub = await runChat(ctx, {
        sessionId: opts.sessionId, botId: target.id, userText: instruction,
        emit, signal: opts.signal, persistUser: false, depth: depth + 1,
      });
      return sub.content;
    } : undefined,
  };

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(opts.sessionId) as any;
  const baseMessages = buildMessages({
    db,
    session: {
      id: session.id, title: session.title, type: session.type,
      createdAt: session.created_at, updatedAt: session.updated_at, meta: JSON.parse(session.meta || '{}'),
    },
    bot, taskCard: opts.taskCard, settings, skillNames, workspaceDir, workspaceDirs,
  });
  // 思考程度落到系统提示里（同一套模型，不同档位的目标函数不一样）
  if (baseMessages[0]) {
    const extra = [
      profile.directive,
      trigger ? `【思考触发】用户这轮明确说了「${trigger.label}」，按更高档位处理：先拆解再动手，结论要给依据。` : '',
      opts.plan
        ? '【计划模式】现在只做调研和设计：可以读文件、列目录、搜资料，但不要写文件、不要执行命令、不要抓外网。把计划整理成「目标 / 步骤 / 涉及文件 / 验收标准 / 风险与回滚」，然后调用 exit_plan_mode 提交，等用户批准后再执行。'
        : '',
    ].filter(Boolean).join('\n\n');
    if (extra) {
      baseMessages[0] = {
        ...baseMessages[0],
        content: `${baseMessages[0].content ?? ''}\n\n${extra}`,
      };
    }
  }

  const errors: string[] = [];
  for (let attempt = 0; attempt < decision.chain.length; attempt++) {
    const model = decision.chain[attempt];
    const apiKey = registry.apiKey(env, model.provider);
    if (!apiKey) { errors.push(`${model.label}: 无 Key`); continue; }
    emit({
      type: 'route', provider: model.provider, model: model.id,
      reason: attempt === 0 ? decision.reason : `降级自 ${decision.chain[attempt - 1].label}：${errors[errors.length - 1] ?? ''}；${decision.reason}`,
      degraded: attempt > 0, attempt,
    });

    const messages: LLMMessage[] = structuredClone(baseMessages);
    let totalIn = 0, totalOut = 0, totalCached = 0, totalLatency = 0;
    // 同参数重复调用检测（对齐 DSH 的 repeat-tool-reminder：3/5/8 次时提醒，只提醒不拦截）
    const repeatCounts = new Map<string, number>();
    const repeatKey = (name: string, args: Record<string, unknown>): string => {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(args ?? {}).sort()) sorted[k] = (args as any)[k];
      return `${name}:${JSON.stringify(sorted)}`;
    };

    try {
      let finalContent = '';
      for (let step = 0; step < profile.maxSteps; step++) {
        const result = await chatStream({
          provider: model.provider,
          baseURL: registry.baseURL(model.provider),
          apiKey,
          model: model.id,
          messages,
          tools: toolSchemas(bot),
          temperature: profile.temperature,
          thinking: model.provider === 'glm' ? (profile.id === 'deep' ? 'enabled' : 'disabled') : undefined,
          signal: opts.signal,
          onDelta: (text, channel) => emit({ type: 'token', text, channel }),
        });
        totalIn += result.usage.inputTokens;
        totalOut += result.usage.outputTokens;
        totalCached += result.usage.cachedTokens ?? 0;
        totalLatency += result.usage.latencyMs ?? 0;
        recordUsage(db, {
          provider: model.provider, model: model.id,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
          costEst: costEstimate(model.provider, model.id, registry, result.usage.inputTokens, result.usage.outputTokens),
          sessionId: opts.sessionId,
        });

        if (result.toolCalls.length === 0) {
          finalContent = result.content || '（模型未返回内容）';
          break;
        }

        // 有工具调用 → 执行后继续循环
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
        for (const tc of result.toolCalls) {
          const tool = findTool(tc.name);
          emit({ type: 'tool_call', callId: tc.id, tool: tc.name, args: tc.args });
          let outcome: { ok: boolean; output: string };
          if (!tool) {
            outcome = { ok: false, output: `未知工具：${tc.name}` };
          } else {
            try {
              outcome = await tool.run(tc.args, toolCtx);
            } catch (e: any) {
              outcome = { ok: false, output: `工具执行异常：${e?.message ?? e}` };
            }
          }
          // 长输出先压缩再入上下文（全文落盘，模型可 expand_output 读回）
          const packed = packToolOutput({
            db, env, sessionId: opts.sessionId, tool: tc.name, output: outcome.output,
          });
          emit({
            type: 'tool_result', callId: tc.id, ok: outcome.ok,
            preview: packed.compressed
              ? `已压缩 ${packed.originalChars} → ${packed.shownChars} 字符（${packed.id}，可 expand_output 读回）`
              : outcome.output.slice(0, 200),
          });
          messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: packed.text });

          const key = repeatKey(tc.name, tc.args);
          const times = (repeatCounts.get(key) ?? 0) + 1;
          repeatCounts.set(key, times);
          if (times === 3 || times === 5 || times === 8) {
            messages.push({
              role: 'system',
              content: `【循环提醒】这是第 ${times} 次用完全相同的参数调用 ${tc.name}。先读上一次的结果，换个思路或直接收尾；不要原样重试。`,
            });
            emit({
              type: 'notice', level: 'warn',
              message: `检测到重复调用（${tc.name} ×${times}），已提醒模型换思路`,
            });
          }
        }
      }
      if (!finalContent) {
        // 工具轮次用尽：再给模型一次「不许调工具、只做收尾」的机会，而不是直接塞占位文案
        emit({ type: 'notice', level: 'warn', message: '工具调用达到上限，已停止工具并生成阶段汇总' });
        try {
          const fin = await chatStream({
            provider: model.provider,
            baseURL: registry.baseURL(model.provider),
            apiKey,
            model: model.id,
            messages: [
              ...messages,
              {
                role: 'system',
                content: '工具调用已到上限。不要再调用工具，直接基于已有信息给出最终答复；缺少什么信息就明确说明缺什么。',
              },
            ],
            temperature: profile.temperature,
            thinking: model.provider === 'glm' ? 'disabled' : undefined,
            signal: opts.signal,
          });
          finalContent = fin.content?.trim() || '（工具调用达到上限，已有结果不足，无法形成结论）';
          totalIn += fin.usage.inputTokens;
          totalOut += fin.usage.outputTokens;
          totalCached += fin.usage.cachedTokens ?? 0;
          totalLatency += fin.usage.latencyMs ?? 0;
          recordUsage(db, {
            provider: model.provider, model: model.id,
            inputTokens: fin.usage.inputTokens, outputTokens: fin.usage.outputTokens,
            costEst: costEstimate(model.provider, model.id, registry, fin.usage.inputTokens, fin.usage.outputTokens),
            sessionId: opts.sessionId,
          });
        } catch {
          finalContent = '（工具调用达到上限，收尾请求也失败；建议把任务拆小后重试）';
        }
      }

      const message = insertMessage(db, {
        sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: bot.name,
        content: finalContent, provider: model.provider, model: model.id,
        routeReason: attempt === 0 ? decision.reason : `${decision.reason}（由 ${decision.chain[attempt - 1].label} 降级）`,
        degraded: attempt > 0,
        thinking: effort,
        usage: { inputTokens: totalIn, outputTokens: totalOut, cachedTokens: totalCached, latencyMs: totalLatency },
      });
      // 角色输出契约校验：只检查结构是否齐全，缺了就提示用户可以让它补
      if (depth === 0) {
        const role = roleForBotName(bot.name);
        const missing = role ? missingContract(role, finalContent) : [];
        if (missing.length > 0) {
          emit({
            type: 'notice', level: 'warn',
            message: `这个角色要求「${missing.join(' / ')}」，这次回复没写全。回一句「补上${missing[0]}」可以让它重写。`,
          });
        }
      }
      emit({ type: 'message_done', message });
      emit({
        type: 'done',
        usage: { inputTokens: totalIn, outputTokens: totalOut, costEst: costEstimate(model.provider, model.id, registry, totalIn, totalOut) },
        degraded: attempt > 0,
      });

      // 长对话摘要（后台）
      void maybeSummarize({
        db,
        sessionId: opts.sessionId,
        callCheap: async (prompt) => {
          const fast = registry.allModels().find((m) => m.tier === 'fast' && keyedProviders.includes(m.provider))
            ?? registry.allModels().find((m) => keyedProviders.includes(m.provider));
          if (!fast) return '';
          const r = await chatStream({
            provider: fast.provider, baseURL: registry.baseURL(fast.provider),
            apiKey: registry.apiKey(env, fast.provider)!, model: fast.id,
            messages: [{ role: 'user', content: prompt }],
          });
          return r.content;
        },
      });

      recordRouteSuccess(model.provider);
      return message;
    } catch (e) {
      // 用户点了停止：不要再走降级/换模型，直接把这一轮结束
      if (opts.signal?.aborted) {
        emit({ type: 'done' });
        return null as unknown as ChatMessage;
      }
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${model.label}: ${msg}`);
      // 只有「换一家可能好」的错误才记熔断；400 这类是我们自己的请求问题，不赖供应商
      if (isFailoverWorthy(e)) recordRouteFailure(model.provider);
      if (!isFailoverWorthy(e) || attempt === decision.chain.length - 1) {
        // 不可降级的错误或已是链尾 → 报错收场
        const failContent = `全部模型调用失败。\n${errors.map((x) => `- ${x}`).join('\n')}\n\n请检查 API Key / 网络 / 余额。`;
        const m = insertMessage(db, {
          sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: bot.name,
          content: failContent, routeReason: '执行失败', degraded: true,
        });
        emit({ type: 'message_done', message: m });
        emit({ type: 'error', message: failContent });
        emit({ type: 'done', degraded: true });
        return m;
      }
      // 继续尝试下一个模型
    }
  }

  const failContent = `没有可用的模型。\n${errors.map((x) => `- ${x}`).join('\n')}`;
  const m = insertMessage(db, { sessionId: opts.sessionId, role: 'assistant', botId: bot.id, botName: bot.name, content: failContent, routeReason: '无可用模型' });
  emit({ type: 'message_done', message: m });
  emit({ type: 'done' });
  return m;
}

export function getSettingsLive(db: Db): () => AppSettings {
  return () => getSetting(db, 'settings', DEFAULT_SETTINGS);
}
