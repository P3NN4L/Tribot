// 角色评测：跑固定任务，量化「角色画像 vs 通用 agent」的输出契约完成度。
// 用法：
//   pnpm eval:roles            # 有可用供应商就真跑（会消耗 token）
//   pnpm eval:roles --dry      # 只做自检，不调模型
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.TRIBOT_URL || 'http://127.0.0.1:52805';
const dry = process.argv.includes('--dry');

const ROLES = [
  {
    name: '研究员',
    task: '查一下 2026 年 DeepSeek 与 Qwen 的最新旗舰模型各自的主打能力差异，给出来源。',
    contract: ['结论', '要点', '不确定'],
  },
  {
    name: '工程师',
    task: '这个仓库里 src/router/index.ts 的打分函数有哪些可改进点？给出你会怎么改、怎么验证。',
    contract: ['改动', '验证'],
  },
  {
    name: '管家',
    task: '检查 data/tasks 下最近三个任务目录是否有产物文件，输出一份巡检简报。',
    contract: ['状态', '建议'],
  },
  {
    name: '总管',
    task: '把「评估三家模型的成本和效果并给出选型建议」拆成子任务并说明分派安排。',
    contract: ['结论', '依据', '下一步'],
  },
];

function score(text, contract) {
  const urls = (text.match(/https?:\/\/[^\s)）]+/g) ?? []).length;
  const sections = contract.filter((k) => text.includes(k)).length;
  const numbered = /(^|\n)\s*(\d+[.、]|[-*])\s+/.test(text);
  return {
    length: text.length,
    sections,
    contractRate: contract.length ? sections / contract.length : 0,
    urls,
    hasList: numbered,
  };
}

function selfTest() {
  const sample = '结论：A。\n\n要点：\n- 事实 —— https://example.com（2026-01）\n\n不确定：无';
  const s = score(sample, ['结论', '要点', '不确定']);
  const ok = s.sections === 3 && s.urls === 1 && s.hasList;
  console.log('self-test', ok ? 'PASS' : 'FAIL', s);
  process.exit(ok ? 0 : 1);
}

async function getJson(p) {
  const r = await fetch(`${BASE}${p}`);
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
}

async function runOne(role, botId, sessionTitle) {
  const created = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ title: sessionTitle, type: 'chat' }),
  }).then((r) => r.json());
  const sessionId = created.session.id;

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ sessionId, botId, content: role.task, mode: 'auto', thinking: 'standard' }),
  });
  if (!res.body) throw new Error('没有 SSE 响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let done = false;
  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === 'delta' && evt.text) content += evt.text;
      if (evt.type === 'message_done' && evt.message?.content) content = evt.message.content;
      if (evt.type === 'done') done = true;
    }
  }
  return { sessionId, content, ...score(content, role.contract) };
}

async function main() {
  if (process.argv.includes('--self-test')) selfTest();
  if (dry) {
    console.log('[dry] 自检通过；未调用模型');
    selfTest();
    return;
  }

  const [{ providers }, { bots }] = await Promise.all([getJson('/api/providers'), getJson('/api/bots')]);
  const keyed = providers.filter((p) => p.hasKey && p.models.length > 0);
  if (keyed.length === 0) {
    console.log('没有可用的模型供应商（先配置 Key 再跑评测）');
    return;
  }

  const rows = [];
  for (const role of ROLES) {
    const bot = bots.find((b) => b.name === role.name);
    if (!bot) continue;
    process.stdout.write(`跑 ${role.name}… `);
    try {
      const r = await runOne(role, bot.id, `eval · ${role.name}`);
      rows.push({ role: role.name, ...r });
      console.log(`契约 ${(r.contractRate * 100).toFixed(0)}% · ${r.length} 字 · 链接 ${r.urls}`);
    } catch (e) {
      console.log('失败：' + e.message);
      rows.push({ role: role.name, error: e.message });
    }
  }

  const md = [
    '# 角色输出契约评测',
    '',
    `- 时间：${new Date().toLocaleString('zh-CN')}`,
    `- 供应商：${keyed.map((p) => p.label).join('、')}`,
    '',
    '| 角色 | 契约完成度 | 字数 | 链接数 | 列表 |',
    '|---|---|---|---|---|',
    ...rows.map((r) => (r.error
      ? `| ${r.role} | 失败 | - | - | - |`
      : `| ${r.role} | ${(r.contractRate * 100).toFixed(0)}% | ${r.length} | ${r.urls} | ${r.hasList ? '是' : '否'} |`)),
    '',
    '> 契约完成度 = 输出里出现了几节角色要求的固定小节（如研究员的「结论/要点/不确定」）。',
    '> 这是结构指标，不判断内容质量；内容质量需要人工或 LLM 评审。',
    '',
  ].join('\n');

  const out = path.join('docs', 'eval-roles.md');
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(out, md + (fs.existsSync(out) ? '\n' + fs.readFileSync(out, 'utf8') : ''), 'utf8');
  console.log('\n写入', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
