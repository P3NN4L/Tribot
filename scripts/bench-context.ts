// ===== TriBot 上下文省 token 实测 =====
// 用真实仓库文件 + 真实 Bot 配置（data/tribot.db）+ 真实工具 Schema 计算 token 数。
// tokenizer: gpt-tokenizer (cl100k_base)，作为跨模型的统一参照；GLM/DeepSeek 的 tokenizer 略有差异。
import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'gpt-tokenizer';
import { openDb, listBots } from '../packages/core/src/db.js';
import { buildSystemPrompt } from '../packages/core/src/engine/memory.js';
import { toolSchemas } from '../packages/core/src/tools/index.js';
import { DEFAULT_SETTINGS } from '../packages/shared/src/index.js';

const root = process.cwd();
const tok = (s: string) => encode(s).length;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((1 - a / b) * 1000) / 10);
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---- 真实配置：从本地 DB 读当前 Bot 与技能 ----
const db = openDb(path.join(root, 'data'));
const bot = listBots(db)[0];
const skillNames = (db.prepare('SELECT name FROM skills WHERE enabled = 1 LIMIT 30').all() as any[]).map((r) => r.name);
const settings = { ...DEFAULT_SETTINGS, sandbox: 'workspace' as const };
const session = {
  id: 'bench', title: 'bench', type: 'chat' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), meta: {},
};
const systemPrompt = buildSystemPrompt({
  bot, session, settings, skillNames,
  workspaceDir: path.join(root, 'data', 'workspaces', bot.name),
});
const schemas = JSON.stringify(toolSchemas(bot));
const systemTokens = tok(systemPrompt);
const toolTokens = tok(schemas);
const prefixTokens = systemTokens + toolTokens;

// ---- 三道闸的参数（与 core 保持一致） ----
const READ_LINES = 2000;
const READ_BYTES = 200_000;
const SPILL_LIMIT = 6000;
const PREVIEW = 1800;

const packed = (text: string) =>
  text.length <= SPILL_LIMIT
    ? text
    : `${text.slice(0, PREVIEW)}\n…〔上下文已压缩〕…\n${text.slice(-300)}`;

// ---- 实验 1：读文件 vs 命令输出 ----
const artifacts = [
  { file: 'packages/core/src/engine/index.ts', kind: 'read' as const, label: '读源码' },
  { file: 'README.md', kind: 'read' as const, label: '读文档' },
  { file: 'pnpm-lock.yaml', kind: 'read' as const, label: '读 lockfile' },
  { file: 'packages/app/build/server.cjs', kind: 'output' as const, label: '命令输出（cat 打包产物）' },
];

const rows = artifacts.map((a) => {
  const text = fs.readFileSync(path.join(root, a.file), 'utf8');
  const lines = text.split(/\r?\n/);
  const tokens = tok(text);
  const packedTokens = tok(packed(text));
  let afterRead: number | null = null;
  let readNote = '';
  if (a.kind === 'read') {
    if (text.length > READ_BYTES) { afterRead = 0; readNote = '直接拒绝（>200KB）'; }
    else if (lines.length > READ_LINES) { afterRead = tok(lines.slice(0, READ_LINES).join('\n')); readNote = `${pct(afterRead, tokens)}%`; }
    else { afterRead = tokens; readNote = '0%（不足 2000 行）'; }
  }
  return {
    ...a,
    chars: text.length,
    lines: lines.length,
    tokens,
    afterRead,
    readNote,
    packedTokens,
    spillSaved: pct(packedTokens, tokens),
  };
});

// ---- 实验 2：40 条历史 → 摘要 + 最近 16 条 ----
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const history: string[] = [];
for (let i = 0; i < 40; i++) {
  const start = (i * 600) % Math.max(1, readme.length - 600);
  history.push(readme.slice(start, start + 600));
}
const historyTokens = history.reduce((n, m) => n + tok(m), 0);
const summaryText = readme.slice(0, 400);
const compactedTokens = tok(summaryText) + history.slice(-16).reduce((n, m) => n + tok(m), 0);

// ---- 实验 3：稳定前缀 × 30 轮（每轮历史 +180 token，缓存命中按输入价 10% 计） ----
const turns = 30;
let totalNoCache = 0;
let totalWithPrefixCache = 0;
for (let t = 1; t <= turns; t++) {
  const hist = t * 180;
  totalNoCache += prefixTokens + hist;
  totalWithPrefixCache += prefixTokens * 0.1 + hist;
}

// ---- 实验 4：重复调用 ----
const repeatedOutput = readme.slice(0, 3000);
const repeatPerCall = tok(repeatedOutput);
const repeatWaste = repeatPerCall * 6;
const repeatSaved = repeatPerCall * 2;

// ---- 实验 5：综合场景（30 轮 + 3 次大输出） ----
const bigOutputs = rows.filter((r) => ['pnpm-lock.yaml', 'packages/app/build/server.cjs', 'README.md'].includes(r.file));
const bigNaive = bigOutputs.reduce((n, r) => n + r.tokens, 0);
const bigTriBot = bigOutputs.reduce((n, r) => n + r.packedTokens, 0);
const scenarioNaive = totalNoCache + bigNaive + repeatWaste;
const scenarioTriBot = totalWithPrefixCache + bigTriBot + repeatSaved;

// ---- 成本（DeepSeek 高峰价，元/百万 token） ----
const PRICE_IN = 0.5;
const cost = (tokens: number, price = PRICE_IN) => (tokens / 1e6) * price;

// ---- 输出 ----
const out: string[] = [];
out.push(`# TriBot 上下文实测（tokenizer: cl100k_base）\n`);
out.push(`> 环境：本仓库真实文件、真实 Bot「${bot.name}」配置、真实工具 Schema（${toolSchemas(bot).length} 个）。`);
out.push(`> 计时口径：token 用 gpt-tokenizer 实测；GLM / DeepSeek 自家 tokenizer 会有 ±10% 差异。\n`);

out.push(`## 0. 固定开销（每轮都要发的前缀）\n`);
out.push(`| 项 | tokens |`);
out.push(`|---|---:|`);
out.push(`| 系统提示（人设 + 环境 + ${skillNames.length} 个技能名） | ${systemTokens} |`);
out.push(`| 工具 Schema（${toolSchemas(bot).length} 个，按 Bot 白名单裁剪） | ${toolTokens} |`);
out.push(`| **合计** | **${prefixTokens}** |\n`);

out.push(`## 1. 三道闸各挡掉多少\n`);
out.push(`| 场景 | 行数 | 全量 tokens | 封顶后 | 压缩后 | 省 |`);
out.push(`|---|---:|---:|---:|---:|---|`);
for (const r of rows) {
  const readCell = r.afterRead == null ? '—' : k(r.afterRead);
  out.push(`| ${r.label} \`${r.file}\` | ${r.lines} | ${k(r.tokens)} | ${readCell} | ${k(r.packedTokens)} | ${r.readNote || '—'} / ${r.spillSaved}% |`);
}
out.push('');
out.push(`> 「封顶」= read_file 默认 2000 行 / 200KB；「压缩」= 工具输出 >6000 字符落盘，只回填头 1800 + 尾 300。\n`);

out.push(`## 2. 长对话：摘要压缩\n`);
out.push(`| | tokens |`);
out.push(`|---|---:|`);
out.push(`| 40 条历史全量 | ${k(historyTokens)} |`);
out.push(`| 400 字摘要 + 最近 16 条 | ${k(compactedTokens)} |`);
out.push(`| **省** | **${pct(compactedTokens, historyTokens)}%** |\n`);

out.push(`## 3. 稳定前缀 × 30 轮：缓存收益\n`);
out.push(`| | tokens |`);
out.push(`|---|---:|`);
out.push(`| 无缓存 | ${k(totalNoCache)} |`);
out.push(`| 前缀命中（按 10% 计价） | ${k(Math.round(totalWithPrefixCache))} |`);
out.push(`| **省** | **${pct(totalWithPrefixCache, totalNoCache)}%** |\n`);

out.push(`## 4. 重复调用提醒\n`);
out.push(`| | tokens |`);
out.push(`|---|---:|`);
out.push(`| 6 次同参数调用（每次 3000 字符输出） | ${k(repeatWaste)} |`);
out.push(`| 提醒后保守少跑 2 次 | 省 ${k(repeatSaved)} (${pct(repeatSaved, repeatWaste)}%) |\n`);

out.push(`## 5. 综合场景：30 轮对话 + 3 次大输出 + 6 次重复调用\n`);
out.push(`| | tokens | 折合 ¥（高峰价） |`);
out.push(`|---|---:|---:|`);
out.push(`| 不用任何机制 | ${k(scenarioNaive)} | ¥${cost(scenarioNaive).toFixed(3)} |`);
out.push(`| TriBot（压缩 + 摘要 + 缓存定价 + 去重） | ${k(Math.round(scenarioTriBot))} | ¥${cost(scenarioTriBot).toFixed(3)} |`);
out.push(`| **合计省** | **${k(Math.round(scenarioNaive - scenarioTriBot))}（${pct(scenarioTriBot, scenarioNaive)}%）** | **¥${cost(scenarioNaive - scenarioTriBot).toFixed(3)}** |\n`);

out.push(`## 6. 放大到 1000 次操作\n`);
out.push(`| 操作 | 省下 tokens / 千次 | 折合 ¥ |`);
out.push(`|---|---:|---:|`);
out.push(`| 读 lockfile（压缩） | ${k(Math.round((rows[2].tokens - rows[2].packedTokens) * 1000))} | ¥${cost((rows[2].tokens - rows[2].packedTokens) * 1000).toFixed(2)} |`);
out.push(`| cat 打包产物（压缩） | ${k(Math.round((rows[3].tokens - rows[3].packedTokens) * 1000))} | ¥${cost((rows[3].tokens - rows[3].packedTokens) * 1000).toFixed(2)} |`);
out.push(`| 30 轮会话（前缀缓存） | ${k(Math.round((totalNoCache - totalWithPrefixCache) * 1000))} | ¥${cost((totalNoCache - totalWithPrefixCache) * 1000).toFixed(2)} |`);
out.push('');

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'token-benchmark.md'), out.join('\n'), 'utf8');
fs.writeFileSync(
  path.join(root, 'docs', 'token-benchmark.json'),
  JSON.stringify({
    systemTokens, toolTokens, prefixTokens, rows,
    historyTokens, compactedTokens, turns, totalNoCache, totalWithPrefixCache,
    repeatWaste, repeatSaved, scenarioNaive, scenarioTriBot,
  }, null, 2),
  'utf8',
);
console.log(out.join('\n'));
