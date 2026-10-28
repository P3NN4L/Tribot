import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/db.js';
import { buildContextInsight, estimateTokens } from '../src/engine/context.js';
import { resolveWorkspaces } from '../src/engine/memory.js';
import { createSession, insertMessage, listBots } from '../src/db.js';
import { seedBots } from '../src/bots/seed.js';
import { DEFAULT_SETTINGS } from '@tribot/shared';
import type { Db } from '../src/db.js';
import type { EnvConfig } from '../src/config.js';
import type { ModelRegistry } from '../src/llm/registry.js';

function stubRegistry(): ModelRegistry {
  return {
    findModel: () => undefined,
    allModels: () => [],
    modelsOfProvider: () => [],
    baseURL: () => 'http://127.0.0.1',
    apiKey: () => undefined,
  } as unknown as ModelRegistry;
}

describe('上下文洞察', () => {
  let db: Db;
  let tmp: string;
  let env: EnvConfig;
  let sessionId: string;
  let botId: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-context-'));
    db = openDb(tmp);
    seedBots(db);
    env = { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} } as unknown as EnvConfig;
    const s = createSession(db, '测试会话');
    sessionId = s.id;
    botId = listBots(db)[0].id;
    insertMessage(db, { sessionId, role: 'user', content: '帮我看下这个项目怎么跑起来' });
    insertMessage(db, { sessionId, role: 'assistant', botId, botName: '总管', content: '先读 README，再跑 pnpm dev。'.repeat(30) });
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const deps = () => ({ db, env, registry: stubRegistry(), getSettings: () => DEFAULT_SETTINGS });

  it('中文按字估算、英文按 3.5 字符估算', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('')).toBe(0);
  });

  it('拆出系统提示 / 工具 / 技能 / 历史，且 used = 各段之和（不含未发送）', () => {
    const insight = buildContextInsight(deps(), { sessionId, botId });
    expect(insight.used).toBeGreaterThan(0);
    expect(insight.budget).toBeGreaterThan(0);
    expect(insight.historyTotal).toBe(2);
    expect(insight.historyIncluded).toBe(2);
    expect(insight.tools).toBeGreaterThan(0);
    const sum = insight.parts
      .filter((p) => p.key !== 'omitted' && p.key !== 'saved')
      .reduce((n, p) => n + p.tokens, 0);
    expect(sum).toBe(insight.used);
    expect(insight.parts.find((p) => p.key === 'system')?.tokens).toBeGreaterThan(0);
  });

  it('给得出可执行建议', () => {
    const insight = buildContextInsight(deps(), { sessionId, botId });
    expect(insight.suggestions.length).toBeGreaterThan(0);
    expect(insight.updatedAt).toBeTruthy();
  });

  it('统计省下的 token 与金额（工具压缩 + 摘要压缩）', () => {
    db.prepare('INSERT INTO tool_outputs(id, session_id, tool, path, original_chars, shown_chars, created_at) VALUES(?,?,?,?,?,?,?)')
      .run('t-save-1', sessionId, 'read_file', 'big.ts', 9000, 2100, new Date().toISOString());
    const insight = buildContextInsight(deps(), { sessionId, botId });
    expect(insight.savings.spillTokens).toBeGreaterThan(0);
    expect(insight.savings.totalTokens).toBe(insight.savings.spillTokens + insight.savings.summaryTokens);
    expect(insight.savings.costSavedYuan).toBeGreaterThan(0);
    expect(insight.savings.pricePerMTok).toBeGreaterThan(0);
  });

  it('会话不存在时报错', () => {
    expect(() => buildContextInsight(deps(), { sessionId: 'nope', botId })).toThrow('session 不存在');
  });

  it('多目录：去重、保持顺序、自动建目录', () => {
    const a = path.join(tmp, 'proj-a');
    const b = path.join(tmp, 'proj-b');
    const list = resolveWorkspaces(tmp, '测试Bot', { workspaces: [a, b, a, ''] });
    expect(list).toEqual([a, b]);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    // 没有配置时退回 Bot 默认工作区
    const fallback = resolveWorkspaces(tmp, '测试Bot', {});
    expect(fallback[0]).toContain('workspaces');
  });
});
