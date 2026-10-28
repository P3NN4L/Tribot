import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb, type Db } from '../src/db.js';
import { seedBots } from '../src/bots/seed.js';
import { ROLE_PROFILES, missingContract, roleForBotName } from '../src/bots/roles.js';

// 角色不是换名字：方法论、工具、思考档位、输出契约都要不同

describe('内置 Bot 团队', () => {
  let db: Db;
  let tmp: string;
  let bots: Array<{ name: string; system_prompt: string; tools: string; thinking: string; role: string }>;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-bots-'));
    db = openDb(tmp);
    seedBots(db);
    bots = db.prepare('SELECT name, system_prompt, tools, thinking, role FROM bots').all() as any;
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('五个角色都在，提示词互不相同', () => {
    expect(bots.map((b) => b.name).sort()).toEqual(['总管', '研究员', '工程师', '管家', '审稿人'].sort());
    expect(new Set(bots.map((b) => b.system_prompt)).size).toBe(5);
    for (const b of bots) {
      expect(b.system_prompt.length).toBeGreaterThan(400);
      expect(b.system_prompt).toContain('【身份】');
      expect(b.system_prompt).toContain('【输出契约】');
      expect(b.system_prompt).toContain('【边界】');
    }
  });

  it('方法论不同：各自有独有的执行步骤', () => {
    const by = Object.fromEntries(bots.map((b) => [b.name, b.system_prompt]));
    expect(by['总管']).toContain('分派模板');
    expect(by['总管']).toContain('验收');
    expect(by['研究员']).toContain('来源分级');
    expect(by['研究员']).toContain('交叉验证');
    expect(by['工程师']).toContain('最小改动');
    expect(by['工程师']).toContain('调试方法');
    expect(by['管家']).toContain('阈值');
    expect(by['审稿人']).toContain('严重度');
    expect(by['审稿人']).toContain('最小修改');
  });

  it('所有 Bot 都拿到全部工具（含 assign），风险由沙箱和审批控制', () => {
    for (const b of bots) {
      const tools = JSON.parse(b.tools) as string[];
      expect(tools).toEqual(['*', 'assign']);
    }
  });

  it('默认思考档位按角色分配', () => {
    const by = Object.fromEntries(bots.map((b) => [b.name, b.thinking]));
    expect(by['总管']).toBe('deep');
    expect(by['工程师']).toBe('deep');
    expect(by['研究员']).toBe('standard');
    expect(by['管家']).toBe('fast');
    expect(by['审稿人']).toBe('deep');
  });

  it('输出契约校验能指出缺项', () => {
    const researcher = ROLE_PROFILES.researcher;
    expect(missingContract(researcher, '结论：可以。要点：A — 来源；不确定：无')).toEqual([]);
    expect(missingContract(researcher, '结论：可以。')).toEqual(['要点', '不确定']);
    expect(roleForBotName('研究员')).toBe(researcher);
    expect(roleForBotName('自定义 Bot')).toBeUndefined();
  });

  it('迁移：用户改过的提示词不动，缺 thinking 的补齐，新增角色会补上', () => {
    db.prepare("UPDATE bots SET system_prompt = ?, thinking = NULL WHERE name = '研究员'").run('我自己改过的提示词');
    db.prepare("DELETE FROM bots WHERE name = '审稿人'").run();
    seedBots(db);
    const custom = db.prepare("SELECT system_prompt, thinking FROM bots WHERE name = '研究员'").get() as any;
    expect(custom.system_prompt).toBe('我自己改过的提示词');
    expect(custom.thinking).toBe('standard');
    expect((db.prepare("SELECT COUNT(*) c FROM bots WHERE name = '审稿人'").get() as any).c).toBe(1);
  });
});
