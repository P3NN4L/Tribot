import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { ApprovalService } from '../src/tools/approval.js';
import { mcpCall, mcpList, loadMcpConfig, mcpConfigPath } from '../src/tools/mcp.js';
import { DEFAULT_SETTINGS, type AppSettings, type Bot } from '@tribot/shared';
import type { Db } from '../src/db.js';
import type { ToolContext } from '../src/tools/index.js';

// ===== MCP stdio 客户端：mcp_list / mcp_call（对着本地假服务器 mcp-echo.mjs）=====

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'mcp-echo.mjs');
const HANG_FIXTURE = path.join(__dirname, 'fixtures', 'mcp-hang.mjs');

function makeBot(): Bot {
  return {
    id: 'test-bot', name: '测试Bot', emoji: '🤖', role: 'test', systemPrompt: 'test',
    tools: ['*'], builtin: false, createdAt: new Date().toISOString(),
  };
}

describe('MCP 工具（stdio 假服务器）', () => {
  let db: Db;
  let tmp: string;
  let settings: AppSettings;

  beforeAll(() => {
    delete process.env.TRIBOT_MCP_CONFIG; // 避免外部环境变量干扰
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-mcp-'));
    db = openDb(tmp);
    settings = { ...DEFAULT_SETTINGS, approval: 'auto' }; // auto：medium 自动放行，方便测 call
    fs.writeFileSync(
      path.join(tmp, 'mcp.json'),
      JSON.stringify({
        servers: [
          { name: 'echo-test', command: process.execPath, args: [FIXTURE] },
        ],
      }),
    );
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = (overrides?: { settings?: AppSettings }): ToolContext => {
    const approvals = new ApprovalService(db, { getSettings: () => overrides?.settings ?? settings }, () => {}, 1000);
    return {
      db,
      env: { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} },
      settings: overrides?.settings ?? settings, bot: makeBot(), sessionId: 's1',
      workspaceDir: tmp, emit: () => {}, approvals,
    };
  };

  it('配置路径：TRIBOT_MCP_CONFIG 优先，默认 dataDir/mcp.json', () => {
    const env = { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} } as any;
    expect(mcpConfigPath(env)).toBe(path.join(tmp, 'mcp.json'));
    process.env.TRIBOT_MCP_CONFIG = 'C:\\somewhere\\custom.json';
    expect(mcpConfigPath(env)).toBe('C:\\somewhere\\custom.json');
    delete process.env.TRIBOT_MCP_CONFIG;
  });

  it('loadMcpConfig：文件不存在时给出友好错误', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-mcp-empty-'));
    try {
      const r = loadMcpConfig({ root: emptyDir, dataDir: emptyDir, port: 1, packaged: false, keys: {} } as any);
      expect('error' in r).toBe(true);
      expect((r as any).error).toContain('mcp.json');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('mcp_list：完整握手后列出 echo / fail_always 工具', async () => {
    const r = await mcpList.run({}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain('echo-test / echo');
    expect(r.output).toContain('echo-test / fail_always');
  }, 30_000);

  it('mcp_call：echo 工具把 arguments 原样回声', async () => {
    const r = await mcpCall.run(
      { server: 'echo-test', tool: 'echo', arguments: { text: '你好TriBot', n: 42 } },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain('echo:');
    expect(r.output).toContain('你好TriBot');
    expect(r.output).toContain('42');
  }, 30_000);

  it('mcp_call：isError=true 的结果 ok=false', async () => {
    const r = await mcpCall.run({ server: 'echo-test', tool: 'fail_always', arguments: {} }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('isError');
  }, 30_000);

  it('mcp_call：未知 server 报错并列出已配置的名字', async () => {
    const r = await mcpCall.run({ server: 'nope', tool: 'echo', arguments: {} }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('echo-test');
  });

  it('mcp_call：JSON-RPC error（未知工具）映射为失败', async () => {
    const r = await mcpCall.run({ server: 'echo-test', tool: 'no_such_tool', arguments: {} }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('未知工具');
  }, 30_000);

  it('权限联动：只读沙箱下 mcp_call 被现有权限体系拦下（不改 policy，验证其生效）', async () => {
    const readOnly = { ...DEFAULT_SETTINGS, approval: 'ask_first', sandbox: 'read_only' as const };
    const r = await mcpCall.run({ server: 'echo-test', tool: 'echo', arguments: { x: 1 } }, ctx({ settings: readOnly }));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('审批未通过');
  }, 30_000);

  it('计划模式：mcp_call 被挡，mcp_list 不受影响', async () => {
    const planCtx = { ...ctx(), planMode: true };
    const r1 = await mcpCall.run({ server: 'echo-test', tool: 'echo', arguments: {} }, planCtx as ToolContext);
    expect(r1.ok).toBe(false);
    expect(r1.output).toContain('计划模式');
    const r2 = await mcpList.run({}, planCtx as ToolContext);
    expect(r2.ok).toBe(true);
  }, 30_000);
});

describe('MCP 超时与进程回收（挂死假服务器）', () => {
  let db2: Db;
  let hangDir: string;
  let pidFile: string;

  beforeAll(() => {
    hangDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-mcp-hang-'));
    pidFile = path.join(hangDir, 'server.pid');
    db2 = openDb(hangDir);
    fs.writeFileSync(
      path.join(hangDir, 'mcp.json'),
      JSON.stringify({
        servers: [{ name: 'hang', command: process.execPath, args: [HANG_FIXTURE, pidFile] }],
      }),
    );
    process.env.TRIBOT_MCP_CONFIG = path.join(hangDir, 'mcp.json'); // 本组用独立配置，不影响上面的 echo 组
  });
  afterAll(() => {
    delete process.env.TRIBOT_MCP_CONFIG;
    try { db2.close(); } catch { /* ignore */ }
    fs.rmSync(hangDir, { recursive: true, force: true });
  });

  const ctx2 = (): ToolContext => {
    const s: AppSettings = { ...DEFAULT_SETTINGS, approval: 'auto' };
    const approvals = new ApprovalService(db2, { getSettings: () => s }, () => {}, 1000);
    return {
      db: db2,
      env: { root: hangDir, dataDir: hangDir, port: 1, packaged: false, keys: {} },
      settings: s, bot: makeBot(), sessionId: 's2',
      workspaceDir: hangDir, emit: () => {}, approvals,
    };
  };

  it('服务器不响应：请求 15s 超时报错，且子进程被回收', async () => {
    const r = await mcpCall.run({ server: 'hang', tool: 'echo', arguments: {} }, ctx2());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('超时');
    // 挂死服务器的进程必须被 kill：kill(pid,0) 应抛 ESRCH（给 3s 宽限轮询）
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(Number.isFinite(pid)).toBe(true);
    let gone = false;
    for (let i = 0; i < 30; i++) {
      try { process.kill(pid, 0); } catch { gone = true; break; }
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(gone).toBe(true);
  }, 30_000);
});
