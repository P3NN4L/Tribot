import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'os';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { ApprovalService } from '../src/tools/approval.js';
import { browser, __resetBrowserStateForTest } from '../src/tools/browser.js';
import { DEFAULT_SETTINGS, type AppSettings, type Bot } from '@tribot/shared';
import type { Db } from '../src/db.js';
import type { ToolContext } from '../src/tools/index.js';

// ===== browser 工具：本地 http 服务 + fixture 页（系统 Chrome headless）=====

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
};

describe('browser 工具（本地 http 页）', () => {
  let db: Db;
  let tmp: string;
  let server: http.Server;
  let base: string;
  let settings: AppSettings;

  beforeAll(async () => {
    // 本地静态服务（127.0.0.1 随机端口），browser 工具只许 http/https，正好合规
    server = http.createServer((req, res) => {
      const name = req.url === '/' || req.url === '/page.html' ? 'page.html'
        : req.url === '/second.html' ? 'second.html' : '';
      if (!name) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] ?? 'text/plain' });
      res.end(fs.readFileSync(path.join(FIXTURES, name)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-browser-'));
    db = openDb(tmp);
    settings = { ...DEFAULT_SETTINGS, approval: 'auto', sandbox: 'full' }; // full+auto：medium 自动放行
  });

  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    __resetBrowserStateForTest(); // 每条用例独立，不依赖执行顺序
  });

  const makeCtx = (over?: { settings?: AppSettings; planMode?: boolean }): ToolContext => {
    const s = over?.settings ?? settings;
    return {
      db,
      env: { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} },
      settings: s,
      bot: {
        id: 't', name: '工程师', emoji: '🛠️', role: '', systemPrompt: '',
        tools: ['*'], builtin: false, createdAt: '',
      },
      sessionId: 's1',
      workspaceDir: tmp,
      emit: () => {},
      planMode: over?.planMode,
      approvals: new ApprovalService(db, { getSettings: () => s }, () => {}, 1000),
    };
  };

  it('没 open 之前：text / click 报错提示先 open', async () => {
    const r = await browser.run({ action: 'text' }, makeCtx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('browser open');
  }, 60_000);

  it('open：返回标题与预览', async () => {
    const r = await browser.run({ action: 'open', url: `${base}/page.html` }, makeCtx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain('TriBot 测试页');
    expect(r.output).toContain('卡片二测试页');
  }, 60_000);

  it('text：正文 + 可交互元素清单', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'text' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('这是一个用于 browser 工具测试的静态页面');
    expect(r.output).toContain('[button] 点我 选择器:#btn');
    expect(r.output).toContain('[input] 搜索词 选择器:input[name="q"]');
  }, 90_000);

  it('text + selector：只取指定元素', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'text', selector: '#status' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('未点击');
    expect(r.output).not.toContain('卡片二测试页');
  }, 90_000);

  it('click：点击后返回页面变化', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'click', selector: '#btn' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('已点击！');
  }, 90_000);

  it('click 链接：跳转到第二页', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'click', selector: '#link2' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('第二页');
  }, 90_000);

  it('click 提交按钮：拒绝自动提交表单', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'click', selector: '#submitbtn' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('不自动提交表单');
  }, 90_000);

  it('screenshot：PNG 落在工作区并返回路径', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'screenshot', path: 'shots/page.png' }, ctx);
    expect(r.ok).toBe(true);
    const abs = path.join(tmp, 'shots', 'page.png');
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.statSync(abs).size).toBeGreaterThan(1000);
  }, 90_000);

  it('screenshot 路径越界：拒绝工作区外的路径', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'screenshot', path: '../escape.png' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('越界');
    expect(fs.existsSync(path.join(path.dirname(tmp), 'escape.png'))).toBe(false);
  }, 90_000);

  it('计划模式：拒绝使用浏览器', async () => {
    const r = await browser.run({ action: 'open', url: `${base}/page.html` }, makeCtx({ planMode: true }));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('计划模式');
  }, 30_000);

  it('只读沙箱：现有权限体系拦截 browser', async () => {
    const readOnly = { ...DEFAULT_SETTINGS, approval: 'ask_first', sandbox: 'read_only' as const };
    const r = await browser.run({ action: 'open', url: `${base}/page.html` }, makeCtx({ settings: readOnly }));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('审批未通过');
  }, 30_000);

  it('open 只允许 http/https：file:// 与缺 url 均被拒绝', async () => {
    const r1 = await browser.run({ action: 'open', url: 'file:///C:/Windows/win.ini' }, makeCtx());
    expect(r1.ok).toBe(false);
    expect(r1.output).toContain('只允许 http/https');
    const r2 = await browser.run({ action: 'open' }, makeCtx());
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain('open 需要 url 参数');
  }, 30_000);

  it('text 给不存在的 selector：报取不到文本', async () => {
    const ctx = makeCtx();
    await browser.run({ action: 'open', url: `${base}/page.html` }, ctx);
    const r = await browser.run({ action: 'text', selector: '#no-such-element' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('没有取到文本');
  }, 90_000);
});
