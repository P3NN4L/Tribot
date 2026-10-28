#!/usr/bin/env node
// 单次测速：node scripts/bench-speed.mjs [model] [thinking] [prompt]
// 依赖本地服务在跑（默认 http://127.0.0.1:52805，可用 BASE 环境变量覆盖）。
// 输出单行 JSON：ttft / total / outTokens / tokPerSec / route 等。
const BASE = process.env.BASE || 'http://127.0.0.1:52805';
const model = process.argv[2];
const thinking = process.argv[3] || 'fast';
const prompt = process.argv[4] || '用三句话解释什么是缓存命中率。';

if (!model) {
  console.error('用法: node scripts/bench-speed.mjs <model> [thinking] [prompt]');
  process.exit(2);
}

const created = await (await fetch(`${BASE}/api/sessions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ title: `测速 ${model}`, type: 'chat' }),
})).json();
const sessionId = created.session.id;
const t0 = performance.now();
let first = 0;
let answer = '';
let usage = null;
let route = null;

const res = await fetch(`${BASE}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ sessionId, content: prompt, mode: 'manual', model, thinking }),
});
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
let done = false;
while (!done) {
  const { value, done: end } = await reader.read();
  if (end) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const p = line.slice(5).trim();
    if (!p) continue;
    let e; try { e = JSON.parse(p); } catch { continue; }
    if (e.type === 'token' && e.channel !== 'reasoning') {
      if (!first) first = performance.now();
      answer += e.text || '';
    }
    if (e.type === 'delta' && e.text) {
      if (!first) first = performance.now();
      answer += e.text;
    }
    if (e.type === 'route') route = e;
    if (e.type === 'message_done') {
      usage = e.message?.usage ?? null;
      if (e.message?.content) answer = e.message.content;
      route = route ?? e.message?.route;
    }
    if (e.type === 'done') done = true;
  }
}
const t1 = performance.now();
const out = usage?.outputTokens ?? 0;
const ttft = first ? (first - t0) / 1000 : 0;
const total = (t1 - t0) / 1000;
const gen = ttft > 0 ? total - ttft : total;
console.log(JSON.stringify({
  model, thinking, ttft: ttft.toFixed(2), total: total.toFixed(2),
  outTokens: out, tokPerSec: gen > 0 ? (out / gen).toFixed(1) : null,
  chars: answer.length, route: route?.model,
  sessionId,
}));
