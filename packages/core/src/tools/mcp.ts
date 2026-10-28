import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { EnvConfig } from '../config.js';
import type { ToolContext, ToolDef } from './index.js';

// ===== MCP stdio 客户端（JSON-RPC 2.0，换行分隔）=====
// 每次 mcp_list / mcp_call 都重新 spawn → initialize → 用完即 kill，不常驻。

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

const PROTOCOL_VERSION = '2024-11-05';
const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 12_000;

function ok(output: string): { ok: boolean; output: string } {
  return { ok: true, output: output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + `\n…（已截断，共 ${output.length} 字符）` : output };
}
function fail(output: string): { ok: boolean; output: string } {
  return { ok: false, output };
}

/** 配置路径：TRIBOT_MCP_CONFIG 环境变量优先，默认 <dataDir>/mcp.json */
export function mcpConfigPath(env: EnvConfig): string {
  return process.env.TRIBOT_MCP_CONFIG || path.join(env.dataDir, 'mcp.json');
}

export function loadMcpConfig(env: EnvConfig): { servers: McpServerConfig[] } | { error: string } {
  const file = mcpConfigPath(env);
  if (!fs.existsSync(file)) {
    return { error: `未找到 MCP 配置 ${file}。格式见 docs/glm-next.md：{"servers":[{"name":"fs","command":"npx","args":[...]}]}` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed?.servers) || parsed.servers.length === 0) {
      return { error: `${file} 里没有配置任何 server（servers 数组为空）` };
    }
    for (const s of parsed.servers) {
      if (!s?.name || !s?.command) return { error: `${file} 中存在缺少 name 或 command 的 server` };
    }
    return parsed as McpConfig;
  } catch (e: any) {
    return { error: `解析 ${file} 失败：${e.message}` };
  }
}

/** Windows 下 npx/npm/pnpm/yarn 是 .cmd，必须走 shell（配置文件本地可信；模型参数走 stdin 不进 shell） */
function needsShell(command: string): boolean {
  return process.platform === 'win32' && /^(npx|npm|pnpm|yarn|cmd|powershell|pwsh)(\.exe|\.cmd|\.bat)?$/i.test(command.trim());
}
function quoteForCmd(arg: string): string {
  return /[ \t"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class McpSession {
  private proc: ChildProcess;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stderrText = '';
  private closed = false;

  private constructor(proc: ChildProcess) {
    this.proc = proc;
    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        this.handleLine(line);
      }
    });
    proc.stderr!.setEncoding('utf8');
    proc.stderr!.on('data', (c: string) => {
      if (this.stderrText.length < 4000) this.stderrText += c;
    });
    proc.on('error', (e) => this.rejectAll(new Error(`进程错误：${e.message}`)));
    proc.on('exit', () => this.rejectAll(new Error('MCP 服务器提前退出了')));
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg?.id !== 'number') return; // 服务器通知，忽略
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`JSON-RPC 错误 ${msg.error.code}：${msg.error.message}`));
    else p.resolve(msg.result);
  }

  private rejectAll(e: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }

  private request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.close();
        reject(new Error(`请求 ${method} 超时（${TIMEOUT_MS / 1000}s）`));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n');
    });
  }

  private notify(method: string): void {
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params: {} }) + '\n');
  }

  /** spawn → initialize → initialized 通知 */
  static async connect(cfg: McpServerConfig): Promise<McpSession> {
    const useShell = needsShell(cfg.command);
    const spawnArgs = cfg.args ?? [];
    const proc = useShell
      ? spawn([cfg.command, ...spawnArgs.map(quoteForCmd)].join(' '), {
          shell: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
          env: cfg.env ? { ...process.env, ...cfg.env } : process.env,
          cwd: cfg.cwd,
        })
      : spawn(cfg.command, spawnArgs, {
          shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
          env: cfg.env ? { ...process.env, ...cfg.env } : process.env,
          cwd: cfg.cwd,
        });

    const session = new McpSession(proc);
    try {
      await session.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'tribot', version: '0.1.0' },
      });
      session.notify('notifications/initialized');
      return session;
    } catch (e: any) {
      session.close();
      const stderr = session.stderrText.trim();
      throw new Error(`${cfg.name} 连接失败：${e.message}${stderr ? `\nstderr: ${stderr.slice(0, 800)}` : ''}`);
    }
  }

  callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.request('tools/call', { name, arguments: args ?? {} });
  }

  listTools(): Promise<any> {
    return this.request('tools/list');
  }

  close(): void {
    this.closed = true;
    for (const [, p] of this.pending) clearTimeout(p.timer);
    this.pending.clear();
    try { this.proc.stdin!.end(); } catch { /* ignore */ }
    try { this.proc.kill(); } catch { /* ignore */ }
  }
}

/** 一次性会话：连接 → 执行 → 关闭（保证不留进程） */
async function withSession<T>(cfg: McpServerConfig, fn: (s: McpSession) => Promise<T>): Promise<T> {
  const session = await McpSession.connect(cfg);
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

/** tools/call 结果 → 文本 */
function formatCallResult(result: any): { ok: boolean; output: string } {
  const parts: string[] = [];
  for (const c of result?.content ?? []) {
    if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else parts.push(JSON.stringify(c));
  }
  const text = parts.join('\n') || JSON.stringify(result);
  return result?.isError ? fail(text) : ok(text);
}

// ---------- 工具定义 ----------

export const mcpList: ToolDef = {
  name: 'mcp_list',
  description: '连上 data/mcp.json 里配置的所有 MCP 服务器，列出它们提供的工具（server / 工具名 / 简介）。调用前先用它看有什么可用。',
  risk: 'low',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx: ToolContext) {
    const cfg = loadMcpConfig(ctx.env);
    if ('error' in cfg) return fail(cfg.error);
    const lines: string[] = [];
    let anyOk = false;
    for (const server of cfg.servers) {
      try {
        const tools = await withSession(server, (s) => s.listTools());
        const list: any[] = tools?.tools ?? [];
        if (list.length === 0) lines.push(`### ${server.name}：（未暴露任何工具）`);
        for (const t of list) {
          lines.push(`${server.name} / ${t.name} / ${String(t.description ?? '').slice(0, 160)}`);
        }
        anyOk = true;
      } catch (e: any) {
        lines.push(`❌ ${server.name}：${e.message}`);
      }
    }
    return anyOk ? ok(lines.join('\n')) : fail(lines.join('\n'));
  },
};

export const mcpCall: ToolDef = {
  name: 'mcp_call',
  description: '调用某个 MCP 服务器的工具。先用 mcp_list 查看可用的 server 和工具名。参数：server（配置里的名字）、tool（工具名）、arguments（对象，工具的入参）。',
  risk: 'medium',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'data/mcp.json 里的 server 名字' },
      tool: { type: 'string', description: '工具名（来自 mcp_list）' },
      arguments: { type: 'object', description: '该工具的入参对象' },
    },
    required: ['server', 'tool'],
  },
  async run(args, ctx: ToolContext) {
    const serverName = String(args.server ?? '').trim();
    const toolName = String(args.tool ?? '').trim();
    if (!serverName || !toolName) return fail('server 和 tool 必填');
    if (ctx.planMode) return fail('计划模式：先提交计划，用户批准后再调用 MCP 工具');

    const cfg = loadMcpConfig(ctx.env);
    if ('error' in cfg) return fail(cfg.error);
    const server = cfg.servers.find((s) => s.name === serverName);
    if (!server) {
      return fail(`没有叫 "${serverName}" 的 MCP server。已配置：${cfg.servers.map((s) => s.name).join('、')}`);
    }

    const decision = await ctx.approvals.request({
      sessionId: ctx.sessionId,
      botName: ctx.bot.name,
      tool: 'mcp_call',
      args: { server: serverName, tool: toolName, arguments: args.arguments ?? {} },
      risk: 'medium',
      reason: `调用 MCP 服务器 "${serverName}" 的工具 "${toolName}"`,
    });
    if (decision !== 'approved') return fail(`审批未通过（${decision === 'denied' ? '已拒绝' : '超时'}）`);

    try {
      const result = await withSession(server, (s) => s.callTool(toolName, (args.arguments as Record<string, unknown>) ?? {}));
      return formatCallResult(result);
    } catch (e: any) {
      return fail(`调用 ${serverName}/${toolName} 失败：${e.message}`);
    }
  },
};
