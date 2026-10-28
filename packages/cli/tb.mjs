#!/usr/bin/env node
// ===== TriBot CLI（tb）：与桌面 App 共用同一个本地 server =====
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';

// ---------- 端口发现：--port > 环境变量 > data/daemon.json > 47615 ----------
function findPort() {
  const pIdx = args.indexOf('--port');
  if (pIdx >= 0 && args[pIdx + 1]) return Number(args[pIdx + 1]);
  if (process.env.TRIBOT_PORT) return Number(process.env.TRIBOT_PORT);
  const candidates = [];
  if (process.env.TRIBOT_DATA_DIR) candidates.push(path.join(process.env.TRIBOT_DATA_DIR, 'daemon.json'));
  // 从 cwd 向上找项目根
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, 'data', 'daemon.json'));
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const f of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j?.port) return j.port;
    } catch { /* next */ }
  }
  return 47615;
}

const PORT = findPort();
const BASE = `http://127.0.0.1:${PORT}`;

async function j(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function requireServer() {
  try {
    await j('/api/health');
  } catch {
    console.error(`连不上 server（${BASE}）。先启动：pnpm dev 或 pnpm dev:server`);
    process.exit(1);
  }
}

// ---------- 命令 ----------
const commands = {
  async help() {
    console.log(`TriBot CLI
用法：tb <命令> [参数]

  chat                交互聊天（Ctrl+C 退出）
  ask "问题"          单次提问（--bot 总管 --mode auto --model <id> --compare "a,b"）
  bots                列出 Bot 团队
  quota               三家配额/余额一览
  sessions            列出会话
  skills              列出已安装技能
  routines            列出定时任务
  status              server 健康检查

端口发现顺序：--port > TRIBOT_PORT > data/daemon.json > 47615`);
  },

  async status() {
    const h = await j('/api/health');
    console.log(`server OK  v${h.version}  http://127.0.0.1:${h.port}`);
    console.log(`keys: glm=${h.keys.glm ? '✅' : '—'}  minimax=${h.keys.minimax ? '✅' : '—'}  deepseek=${h.keys.deepseek ? '✅' : '—'}`);
    console.log(`数据目录：${h.dataDir}`);
  },

  async bots() {
    const { bots } = await j('/api/bots');
    for (const b of bots) console.log(`${b.emoji} ${b.name.padEnd(6)} ${b.role}${b.builtin ? '（内置）' : ''}`);
  },

  async quota() {
    const { providers } = await j('/api/quota');
    for (const p of providers) {
      const bits = [`${p.provider.padEnd(8)}`, `5h:${fmt(p.meter.window5hTokens)}`, `周:${fmt(p.meter.weeklyTokens)}`];
      if (p.meter.window5hLimit) bits.push(`限额:${fmt(p.meter.window5hLimit)}/5h`);
      if (p.balance) bits.push(`余额:¥${p.balance.amount}`);
      if (p.deepseekPeriod) bits.push(p.deepseekPeriod === 'peak' ? '⛔高峰' : '🟢低谷');
      bits.push(p.remote?.ok ? '远程✓' : `远程✗(${p.remote?.detail ?? '—'})`);
      console.log(bits.join('  '));
    }
    console.log('\n（5h/周用量为本地自计量；订阅限额可在 App 设置里填写）');
  },

  async sessions() {
    const { sessions } = await j('/api/sessions');
    for (const s of sessions.slice(0, 30)) console.log(`${s.id.slice(0, 8)}  ${s.title}`);
  },

  async skills() {
    const { skills } = await j('/api/skills');
    if (skills.length === 0) return console.log('（无技能，把 SKILL.md 技能包放进 data/skills/ 再在 App 里扫描）');
    for (const s of skills) console.log(`${s.enabled ? '✅' : '⬜'} ${s.name.padEnd(24)} ${s.description.slice(0, 50)}`);
  },

  async routines() {
    const { routines } = await j('/api/routines');
    for (const r of routines) console.log(`${r.enabled ? '✅' : '⬜'} ${r.schedule.padEnd(12)} ${r.name}`);
  },

  async ask() {
    await requireServer();
    const text = args.filter((a) => !a.startsWith('--')).slice(1).join(' ');
    if (!text) return console.log('用法：tb ask "你的问题"');
    const opts = parseOpts();
    const { session } = await j('/api/sessions', { method: 'POST', body: JSON.stringify({ title: text.slice(0, 18) }) });
    await streamChat(session.id, text, opts);
  },

  async chat() {
    await requireServer();
    const { bots } = await j('/api/bots');
    const { sessions } = await j('/api/sessions');
    const session = sessions[0] ?? (await j('/api/sessions', { method: 'POST', body: '{}' })).session;
    console.log(`进入会话「${session.title}」（Bot：${bots.map((b) => b.name).join('/')}，输入 /bot 名字 切换，Ctrl+C 退出）`);
    let botId = bots[0]?.id;
    let mode = 'auto';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '你> ' });
    rl.prompt();
    rl.on('line', async (line) => {
      const text = line.trim();
      if (!text) return;
      if (text === '/exit' || text === '/quit') process.exit(0);
      const m = /^\/bot\s+(\S+)/.exec(text);
      if (m) {
        const b = bots.find((x) => x.name.includes(m[1]));
        if (b) { botId = b.id; console.log(`→ 已切换到 ${b.emoji} ${b.name}`); }
        else console.log(`没有叫 "${m[1]}" 的 Bot`);
        rl.prompt();
        return;
      }
      const mo = /^\/mode\s+(\S+)/.exec(text);
      if (mo) { mode = mo[1]; console.log(`→ 模式 ${mode}`); rl.prompt(); return; }
      rl.pause();
      await streamChat(session.id, text, { botId, mode });
      rl.resume();
      rl.prompt();
    });
  },
};

function parseOpts() {
  const get = (k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    bot: get('bot'),
    mode: get('mode'),
    model: get('model'),
    compare: get('compare'),
  };
}

function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

async function streamChat(sessionId, content, opts = {}) {
  const { bots } = await j('/api/bots');
  const botId = opts.bot ? bots.find((b) => b.name.includes(opts.bot))?.id : bots[0]?.id;
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId, content, botId,
      mode: opts.mode,
      model: opts.mode === 'manual' ? opts.model : undefined,
      compareModels: opts.compare ? opts.compare.split(',').map((s) => s.trim()) : undefined,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let channel = 'answer';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let e;
      try { e = JSON.parse(line.slice(5)); } catch { continue; }
      if (e.type === 'route') {
        console.log(`\n⟦${e.model}${e.degraded ? ' ·降级' : ''}⟧ ${e.reason}`);
      } else if (e.type === 'token') {
        if (e.channel === 'reasoning') {
          if (channel !== 'reasoning') { process.stdout.write('\n[思考] '); channel = 'reasoning'; }
        } else if (channel !== 'answer') { process.stdout.write('\n[回答] '); channel = 'answer'; }
        process.stdout.write(e.text);
      } else if (e.type === 'tool_call') {
        if (channel !== 'tool') { process.stdout.write('\n'); channel = 'tool'; }
        process.stdout.write(`\n⚙️ ${e.tool} ${JSON.stringify(e.args).slice(0, 100)}`);
      } else if (e.type === 'approval_request') {
        process.stdout.write(`\n🔔 需要审批：${e.approval.reason}（在 App 里批准，等待中…）`);
      } else if (e.type === 'error') {
        process.stdout.write(`\n❌ ${e.message}`);
      } else if (e.type === 'done') {
        process.stdout.write('\n\n');
      }
    }
  }
}

const fn = commands[cmd];
if (!fn) {
  console.log(`未知命令：${cmd}`);
  void commands.help();
} else {
  fn().catch((e) => {
    console.error(`出错了：${e.message}`);
    process.exit(1);
  });
}
