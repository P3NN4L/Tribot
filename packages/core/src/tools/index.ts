import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { AppSettings, Bot, RiskLevel, StreamEvent } from '@tribot/shared';
import type { ToolSchema } from '../llm/client.js';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import type { ApprovalService } from './approval.js';
import { sandboxBlocks } from './policy.js';
import { loadSkillBody } from '../skills/loader.js';
import { readPackedOutput } from '../engine/compress.js';
import { mcpList, mcpCall } from './mcp.js';
import { browser } from './browser.js';
import { desktop } from './desktop.js';
import { addFileCheckpoint } from '../checkpoints.js';
import { recordCommandChanges, snapshotWorkspaces } from './command-checkpoint.js';

// ===== Bot 的「本地电脑」工具集 =====
// 安全边界：文件操作锁死在 data/workspaces/<bot>/ 内；命令白名单+审批；外网 GET 有限放行。

export interface ToolContext {
  db: Db;
  env: EnvConfig;
  settings: AppSettings;
  bot: Bot;
  sessionId: string;
  workspaceDir: string;
  /** 一个任务可以有多个目录（主目录 + 附加目录） */
  workspaceDirs?: string[];
  emit: (e: StreamEvent) => void;
  /** 计划模式：禁止有副作用的工具，先出计划等用户批准 */
  planMode?: boolean;
  /** 总管分派子任务（engine 注入） */
  dispatch?: (botName: string, instruction: string) => Promise<string>;
  approvals: ApprovalService;
}

export interface ToolDef {
  name: string;
  description: string;
  risk: RiskLevel;
  parameters: Record<string, unknown>;
  run(args: any, ctx: ToolContext): Promise<{ ok: boolean; output: string }>;
}

function trunc(s: string, n = 8000): string {
  return s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s;
}

/** 一个任务可以有多个目录：主目录在第一位 */
export function rootsOf(ctx: ToolContext): string[] {
  return ctx.workspaceDirs && ctx.workspaceDirs.length > 0 ? ctx.workspaceDirs : [ctx.workspaceDir];
}

/** 把路径锁进任意一个工作目录，防逃逸 */
export function safeResolve(roots: string[], rel: string): string | null {
  if (path.isAbsolute(rel)) {
    for (const root of roots) {
      const r = path.relative(root, path.resolve(rel));
      if (!r.startsWith('..') && !path.isAbsolute(r)) return path.resolve(rel);
    }
    return null;
  }
  for (const root of roots) {
    const p = path.resolve(root, rel || '.');
    const r = path.relative(root, p);
    if (!r.startsWith('..') && !path.isAbsolute(r)) return p;
  }
  return null;
}

function err(output: string): { ok: boolean; output: string } {
  return { ok: false, output };
}
function ok(output: string): { ok: boolean; output: string } {
  return { ok: true, output };
}

// ===== 会话级的「已读文件」记录 =====
// 借鉴 Claude Code 的 read-before-edit：写已存在的文件前必须先 read_file，
// 避免模型凭印象盲写覆盖（既危险又浪费 token）。
const readPaths: Map<string, Set<string>> =
  ((globalThis as any).__tribotReadPaths ??= new Map());
const normKey = (p: string) => path.normalize(p).toLowerCase();
function markRead(sessionId: string, absPath: string): void {
  let set = readPaths.get(sessionId);
  if (!set) { set = new Set(); readPaths.set(sessionId, set); }
  set.add(normKey(absPath));
}
function hasRead(sessionId: string, absPath: string): boolean {
  return !!readPaths.get(sessionId)?.has(normKey(absPath));
}

const MAX_READ_LINES = 2000;

// ---------- 文件 ----------

const listDir: ToolDef = {
  name: 'list_dir',
  description: '列出工作区（或其子目录）里的文件和文件夹。path 留空表示工作区根目录。',
  risk: 'low',
  parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，如 "src" 或留空' } }, required: [] },
  async run(args, ctx) {
    const dir = safeResolve(rootsOf(ctx), args.path ?? '');
    if (!dir) return err('路径越界：只允许访问自己工作区内的路径');
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.length === 0) return ok('（空目录）');
      return ok(entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n'));
    } catch (e: any) {
      return err(`读取失败：${e.message}`);
    }
  },
};

const readFile: ToolDef = {
  name: 'read_file',
  description: `读取工作区内一个文本文件。默认一次最多返回 ${MAX_READ_LINES} 行；长文件用 offset/limit 分段读（先读头部，需要再往下翻）。`,
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: '从第几行开始（0 基），默认 0' },
      limit: { type: 'number', description: `最多读多少行，默认 ${MAX_READ_LINES}` },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const p = safeResolve(rootsOf(ctx), args.path ?? '');
    if (!p) return err('路径越界');
    try {
      const stat = fs.statSync(p);
      if (stat.size > 200_000) return err(`文件过大（${stat.size} 字节），请分段处理`);
      const text = fs.readFileSync(p, 'utf8');
      const lines = text.split(/\r?\n/);
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
      const limit = Math.max(1, Math.min(MAX_READ_LINES, Math.floor(Number(args.limit ?? MAX_READ_LINES)) || MAX_READ_LINES));
      const slice = lines.slice(offset, offset + limit);
      markRead(ctx.sessionId, p);
      const rest = lines.length - offset - slice.length;
      const header = `[${args.path} 共 ${lines.length} 行，返回第 ${offset + 1}-${offset + slice.length} 行]`;
      const more = rest > 0 ? `\n…（还有 ${rest} 行，继续读请带 offset=${offset + slice.length}）` : '';
      return ok(trunc(`${header}\n${slice.join('\n')}${more}`));
    } catch (e: any) {
      return err(`读取失败：${e.message}`);
    }
  },
};

const OFFICE_READ_PY = `
import sys, os
p = sys.argv[1]
limit = int(sys.argv[2])
ext = os.path.splitext(p)[1].lower()
out = []
if ext == '.pdf':
    from pypdf import PdfReader
    r = PdfReader(p)
    out = [(page.extract_text() or '') for page in r.pages]
elif ext == '.docx':
    import docx
    d = docx.Document(p)
    out = [par.text for par in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            out.append(' | '.join(c.text.strip() for c in row.cells))
elif ext == '.xlsx':
    import openpyxl
    wb = openpyxl.load_workbook(p, data_only=True, read_only=True)
    for ws in wb.worksheets:
        out.append('## ' + ws.title)
        for row in ws.iter_rows(values_only=True):
            if any(v is not None for v in row):
                out.append(' | '.join('' if v is None else str(v) for v in row))
elif ext == '.pptx':
    from pptx import Presentation
    prs = Presentation(p)
    for i, slide in enumerate(prs.slides, 1):
        out.append('## Slide ' + str(i))
        for shape in slide.shapes:
            if hasattr(shape, 'text') and shape.text.strip():
                out.append(shape.text)
else:
    print('UNSUPPORTED:' + ext)
    sys.exit(2)
print('\\n'.join(out)[:limit])
`;

const readDocument: ToolDef = {
  name: 'read_document',
  description: '读取 PDF / Word(.docx) / Excel(.xlsx) / PPT(.pptx) 的文字内容。纯文本文件用 read_file。依赖本机 Python 与 pypdf / python-docx / openpyxl / python-pptx。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '工作区内文档的相对路径，如 "report.pdf"' },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    const p = safeResolve(rootsOf(ctx), args.path ?? '');
    if (!p) return err('路径越界');
    if (!fs.existsSync(p)) return err('文件不存在');
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const r = spawnSync(py, ['-c', OFFICE_READ_PY, p, '120000'], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (r.error) return err(`需要本机 Python（含 pypdf/python-docx/openpyxl/python-pptx）：${r.error.message}`);
    if (r.status !== 0) {
      const detail = (r.stderr ?? '').trim().slice(0, 600);
      return err(detail || '文档解析失败（格式不支持或缺少依赖）');
    }
    const text = (r.stdout ?? '').trim();
    return ok(trunc(text || '（文档没有可提取的文字）'));
  },
};

const writeFile: ToolDef = {
  name: 'write_file',
  description: '在工作区写入/覆盖一个文本文件（自动创建父目录）。只能写自己工作区内的路径。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
  async run(args, ctx) {
    const blocked = sandboxBlocks(ctx.settings.sandbox, 'write_file');
    if (blocked) return err(blocked);
    if (ctx.planMode) return err('计划模式：先提交计划，用户批准后再写文件');
    const p = safeResolve(rootsOf(ctx), args.path ?? '');
    if (!p) return err('路径越界：只允许写工作区内');
    // read-before-edit：覆盖已有文件前必须先读过，否则让模型先看清楚再改
    if (fs.existsSync(p) && !hasRead(ctx.sessionId, p)) {
      return err(`文件已存在：先 read_file 读一遍再改（避免盲写覆盖）。路径：${args.path}`);
    }
    try {
      const existed = fs.existsSync(p);
      if (!existed || fs.statSync(p).size <= 1_000_000) {
        const roots = rootsOf(ctx);
        const root = roots.find((r) => p === path.resolve(r) || p.startsWith(path.resolve(r) + path.sep)) ?? roots[0];
        addFileCheckpoint(ctx.db, {
          sessionId: ctx.sessionId,
          tool: 'write_file',
          root,
          filePath: p,
          before: existed ? fs.readFileSync(p, 'utf8') : null,
          existed,
        });
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(args.content ?? ''), 'utf8');
      markRead(ctx.sessionId, p);
      return ok(`已写入 ${args.path}（${String(args.content ?? '').length} 字符）`);
    } catch (e: any) {
      return err(`写入失败：${e.message}`);
    }
  },
};

// ---------- 命令 ----------

/** 简单分词：支持双引号/单引号包裹 */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of cmd.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const EVAL_FLAGS = /^(-e|--eval|-c|--command|--exec|\/e)$/i;

const runCommand: ToolDef = {
  name: 'run_command',
  description:
    '在工作区目录执行一条命令（如 node script.js、git status、python main.py）。只有白名单内的程序允许执行；带 -e/-c 等直接执行代码的参数会触发人工审批。',
  risk: 'high',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  async run(args, ctx) {
    const cmd = String(args.command ?? '').trim();
    if (!cmd) return err('空命令');
    if (ctx.planMode) return err('计划模式：先提交计划，用户批准后再执行命令');
    const tokens = tokenize(cmd);
    const head = path.basename(tokens[0]).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
    const whitelist = (ctx.settings.commandWhitelist ?? []).map((w) => w.toLowerCase());
    const inWhitelist = whitelist.includes(head);
    const hasEval = tokens.some((t) => EVAL_FLAGS.test(t));
    const pipeOrRedirect = /[|><&]|`|\$\(/.test(cmd);

    let risk: RiskLevel = 'low';
    let reason = '';
    if (hasEval || pipeOrRedirect) {
      risk = 'high';
      reason = hasEval ? '命令包含直接执行代码的参数' : '命令包含管道/重定向';
    } else if (!inWhitelist) {
      risk = 'high';
      reason = `程序 "${head}" 不在白名单`;
    } else {
      risk = 'medium';
      reason = `执行命令：${cmd}`;
    }

    const decision = await ctx.approvals.request({
      sessionId: ctx.sessionId, botName: ctx.bot.name, tool: 'run_command', args: { command: cmd }, risk, reason,
    });
    if (decision !== 'approved') {
      return err(`审批未通过（${decision === 'denied' ? '已拒绝' : '超时'}）：${cmd}`);
    }

    return new Promise((resolve) => {
      const roots = rootsOf(ctx);
      const before = snapshotWorkspaces(roots);
      const quoted = tokens.map((t) => (/[ "\t]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)).join(' ');
      const child = spawn(quoted, {
        shell: true,
        cwd: ctx.workspaceDir,
        windowsHide: true,
        timeout: 120_000,
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (out += d.toString()));
      child.on('error', (e) => resolve(err(`启动失败：${e.message}`)));
      child.on('close', (code) => {
        try { recordCommandChanges(ctx.db, ctx.sessionId, roots, before); } catch { /* 检查点失败不影响命令结果 */ }
        const output = trunc(out || '（无输出）');
        resolve(code === 0 ? ok(`[退出码 0]\n${output}`) : err(`[退出码 ${code}]\n${output}`));
      });
    });
  },
};

// ---------- 网络 ----------

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

const httpFetch: ToolDef = {
  name: 'http_fetch',
  description: 'GET 抓取一个网页/接口的文本内容（最多 256KB）。用于读取公开网页。',
  risk: 'medium',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  async run(args, ctx) {
    let url: URL;
    try {
      url = new URL(String(args.url));
    } catch {
      return err('URL 无效');
    }
    if (ctx.planMode) return err('计划模式：先提交计划，用户批准后再抓取外网');
    if (!/^https?:$/.test(url.protocol)) return err('只允许 http/https');
    if (isBlockedHost(url.hostname)) return err('不允许访问内网/本机地址');
    const decision = await ctx.approvals.request({
      sessionId: ctx.sessionId, botName: ctx.bot.name, tool: 'http_fetch', args: { url: url.toString() },
      risk: 'medium', reason: `访问外部网址：${url.hostname}`,
    });
    if (decision !== 'approved') return err(`审批未通过（${decision}）`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (TriBot)', Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' },
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!/text|json|xml|javascript/i.test(ct)) return ok(`[非文本内容 ${ct}]，状态 ${res.status}`);
      const text = (await res.text()).slice(0, 256 * 1024);
      return ok(`[HTTP ${res.status}]\n${trunc(text)}`);
    } catch (e: any) {
      return err(`请求失败：${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  },
};

const webSearch: ToolDef = {
  name: 'web_search',
  description: '联网搜索。输入查询词，返回带摘要的结果列表（需要配置 Tavily API Key，否则提示离线）。',
  risk: 'low',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return err('空查询');
    if (ctx.settings.search.provider === 'off') return err('联网搜索已在设置中关闭');
    const key = ctx.env.keys.tavily;
    if (!key) return err('未配置 TRIBOT_TAVILY_API_KEY（tavily.com 可免费注册），暂时无法联网');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: ctx.settings.search.maxResults ?? 5,
          include_answer: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return err(`搜索服务错误 HTTP ${res.status}`);
      const data: any = await res.json();
      const parts: string[] = [];
      if (data.answer) parts.push(`摘要：${data.answer}`);
      for (const r of data.results ?? []) {
        parts.push(`- ${r.title}\n  ${r.url}\n  ${String(r.content ?? '').slice(0, 300)}`);
      }
      return ok(parts.join('\n\n') || '（无结果）');
    } catch (e: any) {
      return err(`搜索失败：${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  },
};

// ---------- Skill ----------

const useSkill: ToolDef = {
  name: 'use_skill',
  description: '加载一个已安装的 Skill（开放 SKILL.md 格式）到上下文。先用 list_skills 查看可用技能，或直接按名字调用。',
  risk: 'low',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  async run(args, ctx) {
    const body = await loadSkillBody(ctx.db, String(args.name ?? ''));
    if (!body) return err(`技能 "${args.name}" 不存在或未启用`);
    return ok(trunc(body, 16_000));
  },
};

const listSkills: ToolDef = {
  name: 'list_skills',
  description: '列出当前可用的所有 Skill（名字 + 简介）。',
  risk: 'low',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const rows = ctx.db.prepare('SELECT name, description FROM skills WHERE enabled = 1 ORDER BY name').all() as any[];
    if (rows.length === 0) return ok('（暂无已安装技能，可在「技能」面板扫描目录安装）');
    return ok(rows.map((r) => `- ${r.name}：${String(r.description).slice(0, 120)}`).join('\n'));
  },
};

// ---------- 总管分派 ----------

const assign: ToolDef = {
  name: 'assign',
  description: '把一个子任务分派给另一个 Bot 执行并等待其结果。参数：bot（Bot 名字，如 研究员/工程师）、instruction（给它的完整指令，要说清楚交付什么）。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: { bot: { type: 'string' }, instruction: { type: 'string' } },
    required: ['bot', 'instruction'],
  },
  async run(args, ctx) {
    if (!ctx.dispatch) return err('当前环境不支持分派');
    const botName = String(args.bot ?? '').trim();
    const instruction = String(args.instruction ?? '').trim();
    if (!botName || !instruction) return err('缺少 bot 或 instruction');
    const result = await ctx.dispatch(botName, instruction);
    return ok(trunc(result, 12_000));
  },
};

/** 展开被压缩的工具输出（安全阀，任何 Bot 都可用） */
const expandOutput: ToolDef = {
  name: 'expand_output',
  description: '展开之前被上下文压缩的工具输出：按 id 读回全文，可用 offset/limit 分段。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '压缩时给出的 out_xxx' },
      offset: { type: 'number', description: '从第几个字符开始，默认 0' },
      limit: { type: 'number', description: '最多读多少字符，默认 8000，上限 40000' },
    },
    required: ['id'],
  },
  async run(args, ctx) {
    const id = String(args.id ?? '').trim();
    if (!id) return err('缺少 id');
    const r = readPackedOutput(ctx.db, ctx.sessionId, id, Number(args.offset ?? 0), Number(args.limit ?? 8000));
    return r.ok ? ok(trunc(r.output, 40_000)) : err(r.output);
  },
};

/** 会话待办清单：模型用 TodoWrite 的方式维护，右侧面板实时显示并可手动勾选 */
const todoWrite: ToolDef = {
  name: 'todo_write',
  description: '创建或更新当前会话的待办清单。多步骤任务开始时先列 3~8 项，完成一项就立即把该项标成 completed；用户会在右侧清单里看到并可以手动勾选。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '完整的最新清单（不是增量）；最多一个 in_progress',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '任务内容，简短' },
            done: { type: 'boolean', description: '是否已完成' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['text'],
        },
      },
    },
    required: ['todos'],
  },
  async run(args, ctx) {
    const raw = Array.isArray(args.todos) ? args.todos : [];
    if (raw.length === 0) return err('todos 不能为空');
    const todos = raw.slice(0, 50).map((t: any, i: number) => {
      const done = !!t.done || t.status === 'completed';
      return {
        id: String(t.id || `todo-${Date.now()}-${i}`),
        text: String(t.text ?? '').trim().slice(0, 300),
        done,
        status: done ? 'completed' : (t.status === 'in_progress' ? 'in_progress' : 'pending'),
        priority: t.priority === 'high' || t.priority === 'medium' || t.priority === 'low' ? t.priority : undefined,
      };
    }).filter((t: any) => t.text);
    if (todos.length === 0) return err('没有有效的待办项');
    ctx.emit({ type: 'todos', todos });
    const done = todos.filter((t: any) => t.done).length;
    return ok(`清单已更新：${done}/${todos.length} 完成。用户右侧面板已同步。`);
  },
};

/** 计划模式：把计划提交给用户审批（对齐 DSH 的 exit_plan_mode） */
const exitPlanMode: ToolDef = {
  name: 'exit_plan_mode',
  description: '计划模式下把完成的计划提交给用户审批。只在计划模式使用；提交后本轮不要再做有副作用的事。',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: 'markdown 计划：目标、步骤、涉及的文件/命令、验收标准、风险与回滚',
      },
    },
    required: ['plan'],
  },
  async run(args, ctx) {
    if (!ctx.planMode) return err('当前不在计划模式，不需要提交计划');
    const plan = String(args.plan ?? '').trim();
    if (!plan) return err('计划内容不能为空');
    ctx.emit({ type: 'plan', plan: plan.slice(0, 8000) });
    return ok('计划已提交给用户等待确认。用一句话说明你准备怎么做，然后停下，不要再调用工具。');
  },
};

/** 全部工具（assign 需要显式授权，'*' 白名单不包含它） */
export const ALL_TOOLS: ToolDef[] = [
  listSkills, useSkill, listDir, readFile, readDocument, writeFile, runCommand, httpFetch, webSearch,
  mcpList, mcpCall, browser, desktop, expandOutput, exitPlanMode, assign, todoWrite,
];

export function toolsForBot(bot: Bot): ToolDef[] {
  const list = bot.tools.includes('*')
    ? ALL_TOOLS.filter((t) => t.name !== 'assign')
    : ALL_TOOLS.filter((t) => bot.tools.includes(t.name));
  // '*' 默认不含 assign；显式写了 assign 的 Bot（现在所有内置 Bot）补回来
  if (bot.tools.includes('assign') && !list.some((t) => t.name === 'assign')) {
    const assignTool = ALL_TOOLS.find((t) => t.name === 'assign');
    if (assignTool) list.push(assignTool);
  }
  // expand_output / exit_plan_mode 是系统级安全阀，任何 Bot 都要有
  for (const extra of [expandOutput, exitPlanMode]) {
    if (!list.some((t) => t.name === extra.name)) list.push(extra);
  }
  return list;
}

export function toolSchemas(bot: Bot): ToolSchema[] {
  return toolsForBot(bot).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function findTool(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
