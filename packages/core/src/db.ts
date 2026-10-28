import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Bot, ChatMessage, ProviderId, Routine, Session, SkillMeta, TaskCard } from '@tribot/shared';
import { nowIso, uid } from './config.js';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bots(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, role TEXT NOT NULL,
  system_prompt TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '["*"]', model_pref TEXT,
  thinking TEXT, builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
  bot_id TEXT, bot_name TEXT, content TEXT NOT NULL,
  provider TEXT, model TEXT, route_reason TEXT, degraded INTEGER DEFAULT 0,
  compare_index INTEGER, thinking TEXT, input_tokens INTEGER, output_tokens INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS approvals(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, bot_name TEXT NOT NULL,
  tool TEXT NOT NULL, args TEXT NOT NULL, risk TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS usage_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost_est REAL NOT NULL DEFAULT 0, session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);
CREATE TABLE IF NOT EXISTS skills(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  dir TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, has_scripts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS routines(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule TEXT NOT NULL, bot_id TEXT NOT NULL,
  prompt TEXT NOT NULL, session_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  offpeak_only INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT, last_status TEXT
);
CREATE TABLE IF NOT EXISTS routine_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, routine_id TEXT NOT NULL,
  ts TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_outputs(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool TEXT NOT NULL, path TEXT NOT NULL,
  original_chars INTEGER NOT NULL, shown_chars INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_outputs_session ON tool_outputs(session_id, created_at);
CREATE TABLE IF NOT EXISTS checkpoints(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool TEXT NOT NULL,
  root TEXT NOT NULL, path TEXT NOT NULL, existed INTEGER NOT NULL,
  content TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
`;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'tribot.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // 轻量迁移：老库补列（失败说明列已存在）
  for (const sql of [
    'ALTER TABLE messages ADD COLUMN thinking TEXT',
    'ALTER TABLE messages ADD COLUMN cached_tokens INTEGER',
    'ALTER TABLE messages ADD COLUMN latency_ms INTEGER',
    'ALTER TABLE routines ADD COLUMN offpeak_only INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE bots ADD COLUMN thinking TEXT',
  ]) {
    try { db.exec(sql); } catch { /* 已存在 */ }
  }
  return db;
}

// ---------- 行映射 ----------

export function rowToBot(r: any): Bot {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    role: r.role,
    systemPrompt: r.system_prompt,
    tools: JSON.parse(r.tools),
    modelPref: r.model_pref ?? undefined,
    thinking: r.thinking ?? undefined,
    builtin: !!r.builtin,
    createdAt: r.created_at,
  };
}

export function rowToSession(r: any): Session {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta: JSON.parse(r.meta || '{}'),
  };
}

export function rowToMessage(r: any): ChatMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    botId: r.bot_id ?? undefined,
    botName: r.bot_name ?? undefined,
    content: r.content,
    provider: (r.provider as ProviderId) ?? undefined,
    model: r.model ?? undefined,
    routeReason: r.route_reason ?? undefined,
    degraded: !!r.degraded,
    compareIndex: r.compare_index ?? undefined,
    thinking: (r.thinking as ChatMessage['thinking']) ?? undefined,
    usage:
      r.input_tokens != null || r.output_tokens != null
        ? {
          inputTokens: r.input_tokens ?? 0,
          outputTokens: r.output_tokens ?? 0,
          cachedTokens: r.cached_tokens ?? undefined,
          latencyMs: r.latency_ms ?? undefined,
        }
        : undefined,
    createdAt: r.created_at,
  };
}

export function rowToSkill(r: any): SkillMeta {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    dir: r.dir,
    source: r.source,
    enabled: !!r.enabled,
    hasScripts: !!r.has_scripts,
  };
}

export function rowToRoutine(r: any): Routine {
  return {
    id: r.id,
    name: r.name,
    schedule: r.schedule,
    botId: r.bot_id,
    prompt: r.prompt,
    sessionId: r.session_id,
    enabled: !!r.enabled,
    offpeakOnly: !!r.offpeak_only,
    lastRunAt: r.last_run_at ?? undefined,
    lastStatus: (r.last_status as Routine['lastStatus']) ?? undefined,
  };
}

// ---------- 常用操作 ----------

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function createSession(db: Db, title = '新会话', type: 'chat' | 'task' = 'chat', taskCard?: TaskCard): Session {
  const s: Session = {
    id: uid(),
    title,
    type,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    meta: taskCard ? { taskCard } : {},
  };
  db.prepare('INSERT INTO sessions(id, title, type, created_at, updated_at, meta) VALUES(?,?,?,?,?,?)').run(
    s.id, s.title, s.type, s.createdAt, s.updatedAt, JSON.stringify(s.meta),
  );
  return s;
}

export function touchSession(db: Db, sessionId: string, metaPatch?: Partial<Session['meta']>): void {
  if (metaPatch) {
    const row = db.prepare('SELECT meta FROM sessions WHERE id = ?').get(sessionId) as { meta: string } | undefined;
    if (row) {
      const meta = { ...JSON.parse(row.meta || '{}'), ...metaPatch };
      db.prepare('UPDATE sessions SET meta = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(meta), nowIso(), sessionId,
      );
      return;
    }
  }
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowIso(), sessionId);
}

export function insertMessage(db: Db, m: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ChatMessage {
  const msg: ChatMessage = { id: m.id ?? uid(), createdAt: m.createdAt ?? nowIso(), ...m } as ChatMessage;
  db.prepare(
    `INSERT INTO messages(id, session_id, role, bot_id, bot_name, content, provider, model, route_reason, degraded, compare_index, thinking, input_tokens, output_tokens, cached_tokens, latency_ms, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    msg.id, msg.sessionId, msg.role, msg.botId ?? null, msg.botName ?? null, msg.content,
    msg.provider ?? null, msg.model ?? null, msg.routeReason ?? null, msg.degraded ? 1 : 0,
    msg.compareIndex ?? null, msg.thinking ?? null,
    msg.usage?.inputTokens ?? null, msg.usage?.outputTokens ?? null,
    msg.usage?.cachedTokens ?? null, msg.usage?.latencyMs ?? null,
    msg.createdAt,
  );
  touchSession(db, msg.sessionId);
  return msg;
}

export function listMessages(db: Db, sessionId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(sessionId) as any[];
  return rows.map(rowToMessage);
}

export function listBots(db: Db): Bot[] {
  return (db.prepare('SELECT * FROM bots ORDER BY created_at ASC').all() as any[]).map(rowToBot);
}

export function getBot(db: Db, id: string): Bot | undefined {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as any;
  return row ? rowToBot(row) : undefined;
}
