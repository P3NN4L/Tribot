import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import type { ToolContext, ToolDef } from './index.js';
import { rootsOf, safeResolve } from './index.js';

// ===== 浏览器工具（playwright-core + 系统 Chrome，headless）=====
// 设计（贴卡片「简单可靠优先」）：每次工具调用都 重新启动浏览器 → 打开上次/指定的 URL →
// 执行动作 → 关闭浏览器。跨调用只记住 URL（lastUrl），不做常驻浏览器池、不保留会话/登录态。

let lastUrl: string | undefined;

/** 仅供测试重置内部状态 */
export function __resetBrowserStateForTest(): void {
  lastUrl = undefined;
}

const MAX_TEXT = 8_000;
const MAX_ELEMENTS = 30;
const MAX_PREVIEW = 1_500;

function fail(output: string): { ok: boolean; output: string } {
  return { ok: false, output };
}
function ok(output: string): { ok: boolean; output: string } {
  return { ok: true, output };
}
function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s;
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** 前 30 个可交互元素（a/button/input），给无视觉的 Bot 决定点哪（字符串表达式在浏览器里执行） */
async function elementHints(page: any): Promise<string> {
  const items: Array<{ tag: string; label: string; sel: string }> = await page.evaluate(`(() => {
    const out = [];
    const nodes = Array.from(document.querySelectorAll('a, button, input')).slice(0, ${MAX_ELEMENTS});
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();
      let label = (el.textContent || '').trim().slice(0, 40);
      if (tag === 'input') label = el.placeholder || el.value || '';
      let sel = tag;
      if (el.id) sel = '#' + el.id;
      else if (el.name) sel = tag + '[name="' + el.name + '"]';
      out.push({ tag, label, sel });
    }
    return out;
  })()`);
  if (!Array.isArray(items) || items.length === 0) return '（页面上没有可交互元素）';
  return items.map((i) => `- [${i.tag}] ${i.label || '（无文字）'} 选择器:${i.sel}`).join('\n');
}

const BODY_TEXT_EXPR = `document.body ? document.body.innerText : ''`;

export const browser: ToolDef = {
  name: 'browser',
  description:
    '无头浏览器（系统 Chrome）：打开网页、取可见文本、点元素、导出截图。action：open（打开 url，会记住该页）/ text（取当前页可见文本 + 前 30 个可交互元素，可带 selector 只取某元素）/ click（点 selector，返回点击后的页面变化）/ screenshot（当前页存 PNG 到工作区 path）。每次调用都会重新打开浏览器，登录态不保留。',
  risk: 'medium',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['open', 'text', 'click', 'screenshot'] },
      url: { type: 'string', description: 'open 必填，http/https' },
      selector: { type: 'string', description: 'click 必填；text 可选（只取该元素的文本），如 "#btn"' },
      path: { type: 'string', description: 'screenshot 必填，工作区内的相对路径，如 "shot.png"' },
    },
    required: ['action'],
  },
  async run(args, ctx: ToolContext) {
    if (ctx.planMode) return fail('计划模式：先提交计划，用户批准后再使用浏览器');
    const action = String(args.action ?? '');
    let targetUrl: string;
    if (action === 'open') {
      const u = parseHttpUrl(String(args.url ?? ''));
      if (!u) return fail('open 需要 url 参数（只允许 http/https）');
      targetUrl = u.toString();
      lastUrl = targetUrl; // 记住，供后续 text/click/screenshot
    } else {
      if (!lastUrl) return fail('还没有打开任何页面：先用 browser open <url>');
      targetUrl = lastUrl;
    }

    const decision = await ctx.approvals.request({
      sessionId: ctx.sessionId,
      botName: ctx.bot.name,
      tool: 'browser',
      args: { action, url: targetUrl, selector: args.selector, path: args.path },
      risk: 'medium',
      reason: `浏览器 ${action}：${new URL(targetUrl).hostname}`,
    });
    if (decision !== 'approved') return fail(`审批未通过（${decision === 'denied' ? '已拒绝' : '超时'}）`);

    let chrome;
    try {
      chrome = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20_000 });
    } catch (e: any) {
      return fail(`Chrome 启动失败（需要本机安装 Chrome）：${e?.message ?? e}`);
    }

    try {
      const page = await chrome.newPage();
      await page.goto(targetUrl, { timeout: 30_000, waitUntil: 'domcontentloaded' });
      const title = await page.title();

      if (action === 'open') {
        const preview = String(await page.evaluate(BODY_TEXT_EXPR)).slice(0, 600);
        return ok(
          [
            `已打开：${title}`,
            `URL：${targetUrl}`,
            `正文预览：${preview.replace(/\s+/g, ' ').slice(0, 400) || '（空）'}`,
            '用 browser text 取全文与可交互元素，browser click 点元素，browser screenshot 截图。',
          ].join('\n'),
        );
      }

      if (action === 'text') {
        const body = args.selector
          ? await page.locator(String(args.selector)).first().innerText({ timeout: 5_000 }).catch(() => '')
          : String(await page.evaluate(BODY_TEXT_EXPR));
        if (args.selector && !body) return fail(`选择器 "${args.selector}" 没有取到文本（页面可能没有该元素）`);
        const hints = await elementHints(page);
        return ok(`[标题] ${title}\n\n[正文]\n${trunc(String(body).trim() || '（空）', MAX_TEXT)}\n\n[可交互元素（前 ${MAX_ELEMENTS} 个）]\n${hints}`);
      }

      if (action === 'click') {
        const selector = String(args.selector ?? '');
        if (!selector) return fail('click 需要 selector 参数');
        // 安全：不自动提交表单（提交型按钮 / form 内默认提交的 button 一律拒绝）
        const submitish = await page
          .locator(selector)
          .first()
          .evaluate((el: any) => {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (tag === 'input' && ['submit', 'image'].includes(type)) return true;
            if (tag === 'button' && (type === 'submit' || (type === '' && !!el.closest('form')))) return true;
            return false;
          })
          .catch(() => null);
        if (submitish === null) return fail(`选择器 "${selector}" 找不到元素`);
        if (submitish) return fail(`拒绝： "${selector}" 是表单提交按钮，本工具不自动提交表单`);
        await page.click(selector, { timeout: 10_000 });
        await page.waitForTimeout(600); // 等待页面反应（JS 更新/跳转）
        const afterTitle = await page.title();
        const afterText = String(await page.evaluate(BODY_TEXT_EXPR)).slice(0, MAX_PREVIEW);
        return ok(`已点击 ${selector}。\n[点击后标题] ${afterTitle}\n[点击后正文预览]\n${afterText.trim() || '（空）'}`);
      }

      if (action === 'screenshot') {
        const rel = String(args.path ?? '');
        if (!rel) return fail('screenshot 需要 path 参数（工作区内相对路径，如 "shot.png"）');
        const abs = safeResolve(rootsOf(ctx), rel);
        if (!abs) return fail('路径越界：截图只能保存到工作区内');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        await page.screenshot({ path: abs, fullPage: true });
        const size = fs.statSync(abs).size;
        lastUrl = page.url(); // 点击/跳转可能改了地址，记最新的
        return ok(`截图已保存：${rel}（${(size / 1024).toFixed(1)} KB）`);
      }

      return fail(`未知 action：${action}`);
    } catch (e: any) {
      return fail(`浏览器操作失败：${e?.message ?? e}`);
    } finally {
      try { await chrome.close(); } catch { /* ignore */ }
    }
  },
};
