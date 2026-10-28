import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/db.js';
import { ApprovalService, resolveApproval } from '../src/tools/approval.js';
import { ALL_TOOLS, findTool } from '../src/tools/index.js';
import { sandboxAllows, sandboxBlocks } from '../src/tools/policy.js';
import { DEFAULT_SETTINGS, type AppSettings, type Bot, type StreamEvent } from '@tribot/shared';
import type { Db } from '../src/db.js';

// ===== 安全关键路径：审批门 + 沙箱分级 + 工具授权 =====

function makeBot(): Bot {
  return {
    id: 'test-bot', name: '测试Bot', emoji: '🤖', role: 'test', systemPrompt: 'test',
    tools: ['*'], builtin: false, createdAt: new Date().toISOString(),
  };
}

function settingsWith(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, approval: 'auto', sandbox: 'workspace', grants: [], ...patch };
}

function makeService(db: Db, settings: AppSettings, emit: (e: StreamEvent) => void = () => {}, timeoutMs = 2000) {
  return new ApprovalService(
    db,
    { getSettings: () => settings, saveSettings: (s) => Object.assign(settings, s) },
    emit,
    timeoutMs,
  );
}

describe('ApprovalService', () => {
  let db: Db;
  let tmp: string;
  const events: StreamEvent[] = [];

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-approval-'));
    db = openDb(tmp);
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('auto 模式：medium 自动放行、high 直接拒绝（不静默放行）', async () => {
    const settings = settingsWith({ approval: 'auto' });
    const svc = makeService(db, settings, (e) => events.push(e), 2000);
    const medium = await svc.request({ sessionId: 's1', botName: 'b', tool: 'http_fetch', args: {}, risk: 'medium', reason: 'r' });
    expect(medium).toBe('approved');
    const high = await svc.request({ sessionId: 's1', botName: 'b', tool: 'run_command', args: {}, risk: 'high', reason: 'r' });
    expect(high).toBe('denied');
    const rows = db.prepare('SELECT status FROM approvals ORDER BY created_at').all() as any[];
    expect(rows.map((r) => r.status)).toEqual(['approved', 'denied']);
  });

  it('ask_first 模式：挂起等待外部决定，resolveApproval 放行', async () => {
    const svc = makeService(db, settingsWith({ approval: 'ask_first' }), () => {}, 5000);
    const p = svc.request({ sessionId: 's1', botName: 'b', tool: 'run_command', args: { command: 'node x.js' }, risk: 'high', reason: '白名单外' });
    await new Promise((r) => setTimeout(r, 50));
    const ok1 = resolveApproval('not-exist', 'approved');
    expect(ok1).toBe(false); // 无此审批
    const pending = svc.listPending();
    expect(pending.length).toBe(1);
    const ok = resolveApproval(pending[0].id, 'approved');
    expect(ok).toBe(true);
    expect(await p).toBe('approved');
  });

  it('ask_first 模式：超时自动拒绝', async () => {
    const svc = makeService(db, settingsWith({ approval: 'ask_first' }), () => {}, 30);
    const d = await svc.request({ sessionId: 's1', botName: 'b', tool: 't', args: {}, risk: 'high', reason: 'r' });
    expect(d).toBe('timeout');
  });

  it('批准时选「本会话」会把授权写进 settings.grants，同会话不再问', async () => {
    const settings = settingsWith({ approval: 'ask_first' });
    const svc = makeService(db, settings, () => {}, 5000);
    const p = svc.request({ sessionId: 'sess-A', botName: 'b', tool: 'http_fetch', args: {}, risk: 'high', reason: 'r' });
    await new Promise((r) => setTimeout(r, 30));
    const pending = svc.listPending();
    resolveApproval(pending[pending.length - 1].id, 'approved', 'session');
    expect(await p).toBe('approved');
    expect(settings.grants.some((g) => g.tool === 'http_fetch' && g.scope === 'session')).toBe(true);

    // 同会话第二次：命中授权，直接放行（不再产生 pending）
    const before = svc.listPending().length;
    const again = await svc.request({ sessionId: 'sess-A', botName: 'b', tool: 'http_fetch', args: {}, risk: 'high', reason: 'r' });
    expect(again).toBe('approved');
    expect(svc.listPending().length).toBe(before);
  });

  it('只读沙箱直接拒绝写文件与命令（不进审批）', async () => {
    const settings = settingsWith({ sandbox: 'read_only', approval: 'ask_first' });
    const svc = makeService(db, settings, () => {}, 1000);
    const w = await svc.request({ sessionId: 's1', botName: 'b', tool: 'write_file', args: {}, risk: 'low', reason: 'r' });
    expect(w).toBe('denied');
    const c = await svc.request({ sessionId: 's1', botName: 'b', tool: 'run_command', args: {}, risk: 'medium', reason: 'r' });
    expect(c).toBe('denied');
    const read = await svc.request({ sessionId: 's1', botName: 'b', tool: 'read_file', args: {}, risk: 'low', reason: 'r' });
    expect(read).toBe('approved');
  });
});

describe('沙箱策略', () => {
  it('read_only 只放行只读类工具', () => {
    expect(sandboxAllows('read_only', 'read_file', 'low')).toBe(true);
    expect(sandboxAllows('read_only', 'write_file', 'low')).toBe(false);
    expect(sandboxBlocks('read_only', 'write_file')).toContain('只读');
    expect(sandboxBlocks('read_only', 'read_file')).toBeNull();
  });

  it('workspace 放行写文件但命令仍需审批', () => {
    expect(sandboxAllows('workspace', 'write_file', 'low')).toBe(true);
    expect(sandboxAllows('workspace', 'run_command', 'medium')).toBe(false);
  });

  it('full 放行中危，但高危仍要问', () => {
    expect(sandboxAllows('full', 'run_command', 'medium')).toBe(true);
    expect(sandboxAllows('full', 'run_command', 'high')).toBe(false);
  });
});

describe('工具沙箱', () => {
  let db: Db;
  let tmp: string;
  let workspace: string;
  let settings: AppSettings;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-tools-'));
    db = openDb(tmp);
    workspace = path.join(tmp, 'workspaces', '测试Bot');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'hi');
    settings = settingsWith({ approval: 'auto' }); // medium 自动放行方便测试
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = () => {
    const approvals = makeService(db, settings, () => {}, 1000);
    return {
      db, env: { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} },
      settings, bot: makeBot(), sessionId: 's1', workspaceDir: workspace,
      emit: () => {}, approvals,
    };
  };

  it('工具清单完整', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toContain('list_dir');
    expect(names).toContain('run_command');
    expect(names).toContain('web_search');
    expect(names).toContain('assign');
  });

  it('read_file 正常读取', async () => {
    const r = await findTool('read_file')!.run({ path: 'hello.txt' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain('共 1 行');
    expect(r.output).toContain('hi');
  });

  it('路径逃逸被拒绝（../ 与绝对路径）', async () => {
    const c = ctx();
    const r1 = await findTool('read_file')!.run({ path: '../../etc/passwd' }, c);
    expect(r1.ok).toBe(false);
    const r2 = await findTool('write_file')!.run({ path: path.join(tmp, 'escape.txt'), content: 'x' }, c);
    expect(r2.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'escape.txt'))).toBe(false);
  });

  it('多目录：附加目录可读写，越界仍被拒', async () => {
    const extra = path.join(tmp, 'extra-dir');
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(path.join(extra, 'note.md'), 'extra-content');
    const c = { ...ctx(), workspaceDirs: [workspace, extra] };

    const r = await findTool('read_file')!.run({ path: path.join(extra, 'note.md') }, c);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('extra-content');

    const w = await findTool('write_file')!.run({ path: path.join(extra, 'out.txt'), content: 'ok' }, c);
    expect(w.ok).toBe(true);
    expect(fs.readFileSync(path.join(extra, 'out.txt'), 'utf8')).toBe('ok');

    const bad = await findTool('read_file')!.run({ path: '../../etc/passwd' }, c);
    expect(bad.ok).toBe(false);
  });

  it('只读沙箱下 write_file 被拦', async () => {
    const prev = settings.sandbox;
    settings.sandbox = 'read_only';
    try {
      const r = await findTool('write_file')!.run({ path: 'ro.txt', content: 'x' }, ctx());
      expect(r.ok).toBe(false);
      expect(r.output).toContain('只读');
      expect(fs.existsSync(path.join(workspace, 'ro.txt'))).toBe(false);
    } finally {
      settings.sandbox = prev;
    }
  });

  it('write_file 创建子目录并写入', async () => {
    const r = await findTool('write_file')!.run({ path: 'sub/a/b.txt', content: '深度' }, ctx());
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'sub', 'a', 'b.txt'), 'utf8')).toBe('深度');
  });

  it('write_file 覆盖前写入检查点', async () => {
    const c = ctx();
    await findTool('write_file')!.run({ path: 'checkpoint.txt', content: 'v1' }, c);
    await findTool('read_file')!.run({ path: 'checkpoint.txt' }, c);
    const w = await findTool('write_file')!.run({ path: 'checkpoint.txt', content: 'v2' }, c);
    expect(w.ok).toBe(true);
    const rows = db.prepare("SELECT path, existed, content FROM checkpoints WHERE path LIKE ?").all('%checkpoint.txt') as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1].content).toBe('v1');
    expect(rows[rows.length - 1].existed).toBe(1);
  });

  it('read_file 默认最多 2000 行，可带 offset/limit 分段读', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`);
    fs.writeFileSync(path.join(workspace, 'big.txt'), lines.join('\n'));
    const c = ctx();
    const head = await findTool('read_file')!.run({ path: 'big.txt', limit: 5 }, c);
    expect(head.ok).toBe(true);
    expect(head.output).toContain('共 50 行');
    expect(head.output).toContain('line-1');
    expect(head.output).toContain('line-5');
    expect(head.output).not.toContain('line-6');
    expect(head.output).toContain('offset=5');

    const mid = await findTool('read_file')!.run({ path: 'big.txt', offset: 10, limit: 3 }, c);
    expect(mid.output).toContain('返回第 11-13 行');
    expect(mid.output).toContain('line-11');
    expect(mid.output).not.toContain('line-14');
  });

  it('read-before-write：覆盖已存在文件必须先读，读过就放行', async () => {
    fs.writeFileSync(path.join(workspace, 'guard.txt'), 'original');
    const c = ctx();
    const blocked = await findTool('write_file')!.run({ path: 'guard.txt', content: 'blind' }, c);
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain('先 read_file');
    expect(fs.readFileSync(path.join(workspace, 'guard.txt'), 'utf8')).toBe('original');

    await findTool('read_file')!.run({ path: 'guard.txt' }, c);
    const okWrite = await findTool('write_file')!.run({ path: 'guard.txt', content: 'after-read' }, c);
    expect(okWrite.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'guard.txt'), 'utf8')).toBe('after-read');
  });

  it('新文件不需要先读就能写', async () => {
    const r = await findTool('write_file')!.run({ path: 'brand-new.txt', content: 'x' }, ctx());
    expect(r.ok).toBe(true);
  });

  it('计划模式：写文件 / 跑命令 / 抓外网被拦，读文件正常', async () => {
    const c = { ...ctx(), planMode: true };
    const w = await findTool('write_file')!.run({ path: 'plan.txt', content: 'x' }, c);
    expect(w.ok).toBe(false);
    expect(w.output).toContain('计划模式');
    const r = await findTool('run_command')!.run({ command: 'node -v' }, c);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('计划模式');
    const f = await findTool('http_fetch')!.run({ url: 'https://example.com/x' }, c);
    expect(f.ok).toBe(false);
    expect(f.output).toContain('计划模式');
    const read = await findTool('read_file')!.run({ path: 'hello.txt' }, c);
    expect(read.ok).toBe(true);
  });

  it('exit_plan_mode：计划模式下发出 plan 事件，普通模式拒绝', async () => {
    const events: any[] = [];
    const c = { ...ctx(), planMode: true, emit: (e: any) => events.push(e) };
    const r = await findTool('exit_plan_mode')!.run({ plan: '## 计划\n1. 先读 README' }, c);
    expect(r.ok).toBe(true);
    expect(events[0]).toMatchObject({ type: 'plan' });
    expect(events[0].plan).toContain('先读 README');

    const c2 = ctx();
    const r2 = await findTool('exit_plan_mode')!.run({ plan: 'x' }, c2);
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain('不在计划模式');
  });

  it('run_command：白名单内命令可执行（auto 模式 medium 放行）', async () => {
    const r = await findTool('run_command')!.run({ command: 'node -v' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/v\d+/);
  });

  it('run_command：白名单外程序被拒绝（auto 模式 high 直接拒）', async () => {
    const r = await findTool('run_command')!.run({ command: 'regedit' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('审批未通过');
  });

  it('run_command：eval 参数判高危被拒', async () => {
    const r = await findTool('run_command')!.run({ command: 'node -e "code"' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('审批未通过');
  });

  it('http_fetch：内网地址直接拒绝（不走审批）', async () => {
    const r1 = await findTool('http_fetch')!.run({ url: 'http://127.0.0.1:8080/x' }, ctx());
    expect(r1.ok).toBe(false);
    expect(r1.output).toContain('内网');
    const r2 = await findTool('http_fetch')!.run({ url: 'http://192.168.1.1/admin' }, ctx());
    expect(r2.ok).toBe(false);
  });

  it('http_fetch：外网 URL 在 auto 模式放行（此处用无效域名验证网络分支）', async () => {
    const r = await findTool('http_fetch')!.run({ url: 'https://nonexistent.invalid/x' }, ctx());
    // 请求失败（DNS），但说明通过了审批并真正发起了请求
    expect(r.ok).toBe(false);
    expect(r.output).toContain('请求失败');
  });

  it('web_search：无 Tavily key 时给出明确提示', async () => {
    const r = await findTool('web_search')!.run({ query: 'test' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('TAVILY');
  });

  it('未知工具返回错误', async () => {
    const tool = findTool('nope');
    expect(tool).toBeUndefined();
  });
});
