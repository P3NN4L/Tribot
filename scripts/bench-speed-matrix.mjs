#!/usr/bin/env node
// 矩阵测速驱动器：3 模型 × 3 思考档位，逐个调 scripts/bench-speed.mjs，汇总写 docs/benchmarks.md
// 用法：node scripts/bench-speed-matrix.mjs [--base http://127.0.0.1:47615]
// 注意：会真实调用模型（每个组合约数百 output token）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = flag('--base', process.env.BASE || 'http://127.0.0.1:47615');
const MODELS = flag('--models', 'glm-5.3,glm-5.3-flash,MiniMax-M3.1-Flash').split(',');
const THINK = flag('--think', 'fast,standard,deep').split(',');
const OUT = flag('--out', path.join(root, 'docs', 'benchmarks.md'));

const THINK_LABEL = { fast: '快速', standard: '标准', deep: '深度' };

const rows = [];
for (const model of MODELS) {
  for (const think of THINK) {
    const label = `${model} · ${THINK_LABEL[think] ?? think}`;
    process.stderr.write(`▶ ${label}\n`);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'bench-speed.mjs'), model, think], {
      cwd: root, encoding: 'utf8', env: { ...process.env, BASE },
    });
    const line = (r.stdout || '').trim().split('\n').pop() || '';
    let j = null;
    try { j = JSON.parse(line); } catch { /* 失败记原始输出 */ }
    rows.push({ model, think, label, j, raw: line || (r.stderr || '').slice(0, 200) });
  }
}

const fmt = (v) => (v == null ? '—' : String(v));
const lines = [];
lines.push('# 流式速度基准（benchmarks）');
lines.push('');
lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
lines.push(`- 服务端：\`${BASE}\`（本地 dev server，真实 API）`);
lines.push('- 测量口径：`scripts/bench-speed.mjs`（POST /api/chat 流式）');
lines.push('  - **TTFT** = 请求发出 → 第一个非 reasoning token（秒）');
lines.push('  - **总时** = 请求发出 → done（秒）；**tok/s** = outputTokens ÷ (总时 − TTFT)');
lines.push('  - 固定 prompt：`用三句话解释什么是缓存命中率。`，mode=manual，每组合 1 次');
lines.push('');
lines.push('> 说明：`MiniMax-M3.1-Flash` 不在模型注册表（内置清单只有 MiniMax-M3 / M2）。');
lines.push('> 路由器按设计回退到可用模型，「实际路由」列如实记录回退结果，不是静默失败。');
lines.push('');
lines.push('| 模型 · 档位 | TTFT (s) | 总时 (s) | 输出 tokens | tok/s | 实际路由 |');
lines.push('|---|---:|---:|---:|---:|---|');
for (const r of rows) {
  const j = r.j;
  lines.push(`| ${r.label} | ${j ? fmt(j.ttft) : `**失败** ${r.raw.slice(0, 80)}`} | ${j ? fmt(j.total) : '—'} | ${j ? fmt(j.outTokens) : '—'} | ${j ? fmt(j.tokPerSec) : '—'} | ${j ? `\`${fmt(j.route)}\`` : '—'} |`);
}
lines.push('');
lines.push('---');
lines.push('');
lines.push('原始 JSONL（`scripts/bench-speed.mjs` 逐行输出）：');
lines.push('');
lines.push('```json');
for (const r of rows) lines.push(r.raw);
lines.push('```');
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
process.stderr.write(`✓ 已写入 ${path.relative(root, OUT)}（${rows.length} 个组合）\n`);
// 同时把 JSONL 打到 stdout 方便核对
for (const r of rows) if (r.raw) console.log(r.raw);
