import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import { nowIso } from '../config.js';

// ===== 工具输出压缩（对标 DeepSeek Harness 的 save-token → expand 机制）=====
// 工具返回太长时：全文落盘 + 只把「头 + 尾 + 展开指令」塞回上下文。
// 模型需要细节就调 expand_output(id) 再读，避免一次性把 60k 字符灌进窗口。

export const TOOL_OUTPUT_LIMIT = 6000;
export const TOOL_OUTPUT_PREVIEW = 1800;

export interface PackedOutput {
  text: string;
  compressed: boolean;
  id?: string;
  originalChars: number;
  shownChars: number;
}

export function packToolOutput(args: {
  db: Db;
  env: EnvConfig;
  sessionId: string;
  tool: string;
  output: string;
  limit?: number;
  preview?: number;
}): PackedOutput {
  const limit = args.limit ?? TOOL_OUTPUT_LIMIT;
  const originalChars = args.output.length;
  if (originalChars <= limit) {
    return { text: args.output, compressed: false, originalChars, shownChars: originalChars };
  }
  const id = `out_${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(args.env.dataDir, 'tool-outputs', args.sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.txt`);
  fs.writeFileSync(file, args.output, 'utf8');

  const preview = args.preview ?? TOOL_OUTPUT_PREVIEW;
  const head = args.output.slice(0, preview);
  const tail = args.output.slice(-300);
  const text = [
    head,
    '',
    `…〔上下文已压缩〕原始输出 ${originalChars} 字符，这里保留头部 ${preview} 字符 + 尾部 300 字符。`,
    `需要全文：调用 expand_output(id="${id}")；只读某段：带 offset / limit。`,
    '',
    `…〔尾部片段〕`,
    tail,
  ].join('\n');

  args.db.prepare(
    'INSERT INTO tool_outputs(id, session_id, tool, path, original_chars, shown_chars, created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(id, args.sessionId, args.tool, file, originalChars, text.length, nowIso());

  return { text, compressed: true, id, originalChars, shownChars: text.length };
}

export function readPackedOutput(
  db: Db,
  sessionId: string,
  id: string,
  offset = 0,
  limit = 8000,
): { ok: boolean; output: string; total?: number } {
  const row = db.prepare('SELECT * FROM tool_outputs WHERE id = ? AND session_id = ?').get(id, sessionId) as any;
  if (!row) return { ok: false, output: `找不到输出 ${id}（可能属于别的会话或已被清理）` };
  try {
    const text = fs.readFileSync(row.path, 'utf8');
    const start = Math.max(0, Math.min(text.length, Math.floor(offset) || 0));
    const size = Math.max(1, Math.min(40_000, Math.floor(limit) || 8000));
    const slice = text.slice(start, start + size);
    const rest = text.length - start - slice.length;
    return {
      ok: true,
      total: text.length,
      output: rest > 0
        ? `${slice}\n…（还有 ${rest} 字符，继续读请带 offset=${start + slice.length}）`
        : slice,
    };
  } catch (e: any) {
    return { ok: false, output: `读取失败：${e?.message ?? e}` };
  }
}

export function sessionSaveStats(db: Db, sessionId: string): { count: number; savedChars: number } {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) AS c, COALESCE(SUM(original_chars - shown_chars), 0) AS s FROM tool_outputs WHERE session_id = ?',
    ).get(sessionId) as any;
    return { count: Number(row?.c ?? 0), savedChars: Number(row?.s ?? 0) };
  } catch {
    return { count: 0, savedChars: 0 };
  }
}
