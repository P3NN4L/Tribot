import fs from 'node:fs';
import path from 'node:path';
import type { CheckpointInfo } from '@tribot/shared';
import { nowIso, uid } from './config.js';
import type { Db } from './db.js';

// ===== 写前检查点 =====
// 每次 write_file 覆盖/新建文件前，把旧内容存进 SQLite；右侧「改动」面板可一键回滚。
// 只存 <= 1MB 的文本文件，避免把数据库撑爆。

const MAX_SNAPSHOT_BYTES = 1_000_000;

export interface CheckpointRow extends CheckpointInfo {
  content: string | null;
}

export function addFileCheckpoint(
  db: Db,
  input: { sessionId: string; tool: string; root: string; filePath: string; before: string | null; existed: boolean },
): string | null {
  try {
    if (input.before !== null && Buffer.byteLength(input.before, 'utf8') > MAX_SNAPSHOT_BYTES) return null;
    const id = uid();
    db.prepare(
      'INSERT INTO checkpoints(id, session_id, tool, root, path, existed, content, created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      id, input.sessionId, input.tool, input.root, input.filePath,
      input.existed ? 1 : 0, input.before, nowIso(),
    );
    return id;
  } catch {
    return null;
  }
}

export function listCheckpoints(db: Db, sessionId: string, limit = 50): CheckpointInfo[] {
  const rows = db.prepare(
    'SELECT id, session_id, tool, path, existed, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(sessionId, limit) as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    tool: r.tool,
    path: r.path,
    existed: !!r.existed,
    createdAt: r.created_at,
  }));
}

export function restoreCheckpoint(db: Db, id: string): { ok: boolean; path?: string; message: string } {
  const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!row) return { ok: false, message: '检查点不存在' };
  const root = path.resolve(row.root);
  const target = path.resolve(row.path);
  if (!target.startsWith(root + path.sep) && target !== root) {
    return { ok: false, message: '检查点路径不在原工作区内，已拒绝' };
  }
  try {
    if (row.existed) {
      if (typeof row.content !== 'string') return { ok: false, message: '这个检查点没有保存文件内容' };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, row.content, 'utf8');
    } else {
      fs.rmSync(target, { force: true });
    }
    return { ok: true, path: target, message: row.existed ? '已恢复文件内容' : '已删除新建的文件' };
  } catch (e: any) {
    return { ok: false, message: `回滚失败：${e?.message ?? e}` };
  }
}
