import { nowIso, uid } from '../config.js';
import type { Db } from '../db.js';
import { ROLE_LIST } from './roles.js';

// ===== 内置 Bot 团队 =====
// 角色画像（身份/方法/质量门槛/输出契约）统一定义在 roles.ts，
// 这里只负责落库与老库迁移。

/** 判断是否为我们自己历史版本的提示词（用户改过的不动） */
function isOurs(prompt: string): boolean {
  const p = prompt.trim();
  return p.startsWith('【身份】') || p.startsWith('你是「') || p.startsWith('你是 TriBot 的');
}

export function seedBots(db: Db): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM bots').get() as { c: number }).c;

  if (count === 0) {
    const stmt = db.prepare(
      'INSERT INTO bots(id, name, emoji, role, system_prompt, tools, model_pref, thinking, builtin, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    );
    for (const r of ROLE_LIST) {
      stmt.run(uid(), r.name, r.emoji, r.role, r.prompt, JSON.stringify(r.tools), null, r.thinking, 1, nowIso());
    }
    return;
  }

  const rows = db.prepare('SELECT id, name, system_prompt, thinking FROM bots WHERE builtin = 1').all() as Array<{
    id: string; name: string; system_prompt: string; thinking?: string | null;
  }>;
  const update = db.prepare('UPDATE bots SET system_prompt = ?, role = ?, tools = ?, emoji = ? WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO bots(id, name, emoji, role, system_prompt, tools, model_pref, thinking, builtin, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  );

  for (const r of ROLE_LIST) {
    const row = rows.find((x) => x.name === r.name);
    if (!row) {
      // 新增角色（例如审稿人）：直接补一个内置 Bot
      insert.run(uid(), r.name, r.emoji, r.role, r.prompt, JSON.stringify(r.tools), null, r.thinking, 1, nowIso());
      continue;
    }
    if (isOurs(row.system_prompt)) {
      update.run(r.prompt, r.role, JSON.stringify(r.tools), r.emoji, row.id);
    }
    // thinking 只补空，不覆盖用户显式设置
    if (!row.thinking) db.prepare('UPDATE bots SET thinking = ? WHERE id = ?').run(r.thinking, row.id);
  }

  // 所有 Bot（含自定义）统一给全部工具；风险由沙箱档位与审批控制
  const fullTools = JSON.stringify(['*', 'assign']);
  db.prepare('UPDATE bots SET tools = ? WHERE tools != ?').run(fullTools, fullTools);
}
