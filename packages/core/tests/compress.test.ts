import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/db.js';
import { packToolOutput, readPackedOutput, sessionSaveStats, TOOL_OUTPUT_LIMIT } from '../src/engine/compress.js';
import type { Db } from '../src/db.js';
import type { EnvConfig } from '../src/config.js';

// ===== 长工具输出压缩：全文落盘 + 头尾回填 + expand 读回 =====

describe('工具输出压缩', () => {
  let db: Db;
  let tmp: string;
  let env: EnvConfig;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-compress-'));
    db = openDb(tmp);
    env = { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} } as unknown as EnvConfig;
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('短输出原样返回，不落盘', () => {
    const r = packToolOutput({ db, env, sessionId: 's1', tool: 'read_file', output: 'hi' });
    expect(r.compressed).toBe(false);
    expect(r.text).toBe('hi');
    expect(sessionSaveStats(db, 's1').count).toBe(0);
  });

  it('超长输出被压缩：保留头尾，给出 expand_output 指令，并统计省下的字符', () => {
    const big = 'HEAD-' + 'x'.repeat(TOOL_OUTPUT_LIMIT + 5000) + '-TAIL';
    const r = packToolOutput({ db, env, sessionId: 's1', tool: 'run_command', output: big });
    expect(r.compressed).toBe(true);
    expect(r.id).toMatch(/^out_/);
    expect(r.text.length).toBeLessThan(big.length);
    expect(r.text).toContain('上下文已压缩');
    expect(r.text).toContain(`expand_output(id="${r.id}")`);
    expect(r.text.startsWith('HEAD-')).toBe(true);
    expect(r.text).toContain('-TAIL');

    const stats = sessionSaveStats(db, 's1');
    expect(stats.count).toBe(1);
    expect(stats.savedChars).toBeGreaterThan(0);
  });

  it('expand 能按 offset/limit 读回全文', () => {
    const big = 'A'.repeat(3000) + 'B'.repeat(3000) + 'C'.repeat(3000);
    const r = packToolOutput({ db, env, sessionId: 's2', tool: 'read_file', output: big, limit: 1000, preview: 100 });
    expect(r.compressed).toBe(true);
    const all = readPackedOutput(db, 's2', r.id!, 0, 40000);
    expect(all.ok).toBe(true);
    expect(all.total).toBe(big.length);
    expect(all.output).toBe(big);

    const mid = readPackedOutput(db, 's2', r.id!, 2995, 10);
    expect(mid.ok).toBe(true);
    expect(mid.output.startsWith('AAAAABBBBB')).toBe(true);
    expect(mid.output).toContain('还有');
  });

  it('跨会话读不到别人的输出', () => {
    const r = packToolOutput({ db, env, sessionId: 's3', tool: 'read_file', output: 'z'.repeat(9000) });
    expect(readPackedOutput(db, 'other', r.id!).ok).toBe(false);
  });

  it('写入的文件确实在 data/tool-outputs/<session>/ 下', () => {
    const r = packToolOutput({ db, env, sessionId: 's4', tool: 'http_fetch', output: 'q'.repeat(8000) });
    const row = db.prepare('SELECT * FROM tool_outputs WHERE id = ?').get(r.id!) as any;
    expect(row.path).toContain(path.join('tool-outputs', 's4'));
    expect(fs.readFileSync(row.path, 'utf8').length).toBe(8000);
  });
});
