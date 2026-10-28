import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, Bot, ChatMessage, Session, TaskCard } from '@tribot/shared';
import type { Db } from '../db.js';
import type { LLMMessage } from '../llm/client.js';
import { listMessages, touchSession } from '../db.js';

// ===== 上下文构建 + 长对话摘要压缩 =====

export const RECENT_MESSAGE_COUNT = 120;
export const RECENT_CHAR_BUDGET = 400_000;

export function fmtTaskCard(card: TaskCard): string {
  const lines = [
    '【本次任务卡】',
    `目标：${card.goal}`,
    card.sources ? `数据来源：${card.sources}` : null,
    card.constraints ? `限制：${card.constraints}` : null,
    card.deliverable ? `交付物：${card.deliverable}` : null,
    card.reviewPoint ? `审批点：${card.reviewPoint}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

/** 把系统提示拆成可计量的几段（上下文洞察要用同一套口径） */
export function systemSections(args: {
  bot: Bot;
  session: Session;
  taskCard?: TaskCard;
  settings: AppSettings;
  skillNames: string[];
  workspaceDir: string;
  /** 一个任务可以有多个目录：第一个是主目录 */
  workspaceDirs?: string[];
}): { base: string; env: string; skills: string; task: string; summary: string } {
  const { bot, session, taskCard, settings, skillNames, workspaceDir } = args;
  const roots = args.workspaceDirs?.length ? args.workspaceDirs : [workspaceDir];
  const extras = roots.filter((r) => r.toLowerCase() !== workspaceDir.toLowerCase());
  const now = new Date();
  const base = bot.systemPrompt;
  const env = [
    '【环境信息】',
    `- 当前时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`,
    extras.length > 0
      ? `- 主工作目录：${workspaceDir}（命令默认在这里执行，文件读写也默认在这里）`
      : `- 你的本地工作区目录：${workspaceDir}（文件读写仅限此目录内）`,
    ...(extras.length > 0
      ? [`- 附加目录：${extras.join('；')}（文件读写同样允许；命令仍在主目录执行）`]
      : []),
    `- 危险操作（外部命令、访问外部网址）需要用户审批，被拒绝就换方案，不要重试同一操作`,
    `- 审批模式：${settings.approval === 'auto' ? '自动（高危操作会被直接拒绝）' : '每步询问'}`,
    `- 沙箱级别：${settings.sandbox === 'read_only' ? '只读（不能写文件、不能执行命令）' : settings.sandbox === 'full' ? '全权（中危操作自动放行）' : '工作区（可写文件，命令仍需审批）'}`,
  ].join('\n');
  const skills = skillNames.length > 0
    ? `【可用技能】（用 use_skill 工具按名加载后再按其指引执行）\n${skillNames.map((n) => `- ${n}`).join('\n')}`
    : '';
  const card = taskCard ?? (session.type === 'task' ? (session.meta?.taskCard as TaskCard | undefined) : undefined);
  const task = card ? fmtTaskCard(card) : '';
  const summary = session.meta?.summary ? `【更早对话的摘要】\n${session.meta.summary}` : '';
  return { base, env, skills, task, summary };
}

export function buildSystemPrompt(args: {
  bot: Bot;
  session: Session;
  taskCard?: TaskCard;
  settings: AppSettings;
  skillNames: string[];
  workspaceDir: string;
  workspaceDirs?: string[];
}): string {
  const s = systemSections(args);
  // 顺序很重要：稳定内容（人设/技能/任务）在前，易变的「当前时间/环境」放最后。
  // 这样 system + tools 的前缀在多轮之间保持不变，能吃到 DeepSeek / GLM 的前缀缓存。
  return [s.base, s.skills, s.task, s.summary, s.env].filter(Boolean).join('\n\n');
}

/** 选取最近若干条历史（与真正发出去的口径一致） */
export function selectRecentHistory(history: ChatMessage[]): {
  recent: ChatMessage[];
  omitted: number;
  omittedChars: number;
} {
  const recent: ChatMessage[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && recent.length < RECENT_MESSAGE_COUNT; i--) {
    const m = history[i];
    chars += m.content.length;
    if (chars > RECENT_CHAR_BUDGET && recent.length >= 4) break;
    recent.unshift(m);
  }
  const omitted = history.length - recent.length;
  const omittedChars = history.slice(0, omitted).reduce((n, m) => n + m.content.length, 0);
  return { recent, omitted, omittedChars };
}

export function buildMessages(args: {
  db: Db;
  session: Session;
  bot: Bot;
  taskCard?: TaskCard;
  settings: AppSettings;
  skillNames: string[];
  workspaceDir: string;
  workspaceDirs?: string[];
}): LLMMessage[] {
  const { db, session, bot, taskCard, settings, skillNames, workspaceDir } = args;
  const history = listMessages(db, session.id)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0);

  const { recent } = selectRecentHistory(history);
  const system = buildSystemPrompt({
    bot, session, taskCard, settings, skillNames, workspaceDir, workspaceDirs: args.workspaceDirs,
  });
  const msgs: LLMMessage[] = [{ role: 'system', content: system }];
  for (const m of recent) {
    msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
  }
  return msgs;
}

/** 长对话自动摘要（fire-and-forget，用便宜模型跑）。force=true 时手动压缩。 */
export async function maybeSummarize(args: {
  db: Db;
  callCheap: (prompt: string) => Promise<string>;
  sessionId: string;
  force?: boolean;
}): Promise<boolean> {
  const { db, callCheap, sessionId, force } = args;
  try {
    const all = listMessages(db, sessionId).filter((m) => m.role === 'user' || m.role === 'assistant');
    if (!force && all.length < 34) return false;
    if (force && all.length < 4) return false;
    const sessionRow = db.prepare('SELECT meta FROM sessions WHERE id = ?').get(sessionId) as { meta: string } | undefined;
    if (!sessionRow) return false;
    const meta = JSON.parse(sessionRow.meta || '{}');
    const lastId = all[all.length - 1].id;
    if (!force && meta.summaryUpTo === lastId) return false;

    const keepTail = force ? 8 : 16;
    const toSummarize = all.slice(0, Math.max(0, all.length - keepTail));
    if (meta.summarizedUpTo && !force) {
      const idx = toSummarize.findIndex((m) => m.id === meta.summarizedUpTo);
      if (idx >= 0) toSummarize.splice(0, idx + 1);
    }
    if (toSummarize.length < 4) return false;

    const transcript = toSummarize.map((m) => `${m.role === 'user' ? '用户' : m.botName ?? '助手'}：${m.content.slice(0, 600)}`).join('\n');
    const summary = await callCheap(
      `把以下对话历史压缩成不超过 400 字的摘要，保留：任务目标、已完成的结论、重要的文件路径/链接、尚未解决的事项。直接输出摘要正文：\n\n${transcript}`,
    );
    const merged = meta.summary ? `${meta.summary}\n${summary}` : summary;
    touchSession(db, sessionId, {
      summary: merged.slice(-3000),
      summarizedUpTo: toSummarize[toSummarize.length - 1].id,
      summaryUpTo: lastId,
    });
    return true;
  } catch {
    return false;
  }
}

export function ensureWorkspace(dataDir: string, botName: string): string {
  const dir = path.join(dataDir, 'workspaces', botName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 新建任务时的默认目录：data/tasks/<session 短 id> */
export function defaultTaskWorkspace(dataDir: string, sessionId: string): string {
  const dir = path.join(dataDir, 'tasks', sessionId.slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 会话的工作目录：会话自己指定了绝对路径就用它（不存在则创建），
 * 否则退回 Bot 的默认工作区。
 */
export function resolveWorkspace(dataDir: string, botName: string, custom?: string): string {
  return resolveWorkspaces(dataDir, botName, { workspace: custom })[0];
}

/**
 * 一个任务可以有多个文件夹：第一个是主目录（命令的 cwd、默认写入位置），
 * 其余是附加目录（只读参考、另一个项目等）。中途加目录也走这里。
 */
export function resolveWorkspaces(
  dataDir: string,
  botName: string,
  meta?: { workspace?: string; workspaces?: string[] },
): string[] {
  const raw = Array.isArray(meta?.workspaces) && meta!.workspaces!.length > 0
    ? meta!.workspaces!
    : meta?.workspace
      ? [meta.workspace]
      : [];
  const list: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const abs = path.resolve(item.trim());
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fs.mkdirSync(abs, { recursive: true });
    list.push(abs);
  }
  return list.length > 0 ? list : [ensureWorkspace(dataDir, botName)];
}
