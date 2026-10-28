import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addFileCheckpoint } from '../checkpoints.js';
import type { Db } from '../db.js';

// run_command 前后对比：只给真正变化的文本文件建检查点，避免整目录快照。
// 限制：最多扫 1500 个文件 / 单文件 1MB / 总计 20MB；跳过依赖、构建产物和 .git。

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
const MAX_FILES = 1500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 20_000_000;

export interface WorkspaceSnapshot {
  files: Map<string, { content: string; hash: string; root: string }>;
  truncated: boolean;
}

function walk(root: string, out: Map<string, { content: string; hash: string; root: string }>, budget: { files: number; bytes: number }): void {
  const stack = [root];
  while (stack.length > 0) {
    if (budget.files >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES) return;
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budget.files >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) continue; // 二进制跳过
        budget.files += 1;
        budget.bytes += buf.length;
        const content = buf.toString('utf8');
        out.set(path.resolve(full), {
          content,
          hash: crypto.createHash('sha1').update(buf).digest('hex'),
          root,
        });
      } catch {
        /* 单个文件读失败不影响整体 */
      }
    }
  }
}

export function snapshotWorkspaces(roots: string[]): WorkspaceSnapshot {
  const files = new Map<string, { content: string; hash: string; root: string }>();
  const budget = { files: 0, bytes: 0 };
  for (const root of roots) {
    if (budget.files >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES) break;
    walk(root, files, budget);
  }
  return { files, truncated: budget.files >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES };
}

/** 命令结束后对比快照，给变化/新增文件落检查点；返回记录数 */
export function recordCommandChanges(
  db: Db,
  sessionId: string,
  roots: string[],
  before: WorkspaceSnapshot,
): number {
  const after = snapshotWorkspaces(roots);
  let recorded = 0;
  for (const [filePath, prev] of before.files) {
    if (recorded >= 100) break;
    const next = after.files.get(filePath);
    if (next && next.hash === prev.hash) continue;
    if (addFileCheckpoint(db, {
      sessionId, tool: 'run_command', root: prev.root, filePath, before: prev.content, existed: true,
    })) recorded += 1;
  }
  for (const [filePath, next] of after.files) {
    if (recorded >= 100) break;
    if (before.files.has(filePath)) continue;
    if (addFileCheckpoint(db, {
      sessionId, tool: 'run_command', root: next.root, filePath, before: null, existed: false,
    })) recorded += 1;
  }
  return recorded;
}
