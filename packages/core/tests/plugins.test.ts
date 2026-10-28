import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/db.js';
import { installPlugin, listPlugins, togglePlugin, uninstallPlugin } from '../src/plugins/index.js';
import { PLUGIN_CATALOG } from '../src/plugins/catalog.js';
import { DEFAULT_SETTINGS } from '@tribot/shared';
import type { Db } from '../src/db.js';
import type { EnvConfig } from '../src/config.js';

// ===== 插件市场：安装 = 落一个 SKILL.md 到 data/skills/<id>/ =====

describe('插件市场', () => {
  let db: Db;
  let tmp: string;
  let env: EnvConfig;
  const settings = { ...DEFAULT_SETTINGS };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-plugins-'));
    db = openDb(tmp);
    env = { root: tmp, dataDir: tmp, port: 1, packaged: false, keys: {} } as unknown as EnvConfig;
  });
  afterAll(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('目录里有 8 个以上插件，且初始都未安装', () => {
    const catalog = listPlugins(db, env);
    expect(catalog.plugins.length).toBeGreaterThanOrEqual(8);
    expect(catalog.installed).toBe(0);
    expect(catalog.categories.length).toBeGreaterThan(0);
  });

  it('安装后写入 SKILL.md、出现在技能表，并标记 installed', () => {
    const plugin = installPlugin(db, env, settings, 'deep-research');
    expect(plugin.installed).toBe(true);
    expect(plugin.enabled).toBe(true);
    const file = path.join(tmp, 'skills', 'deep-research', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('name:');
    const row = db.prepare('SELECT * FROM skills WHERE dir = ?').get(path.normalize(path.join(tmp, 'skills', 'deep-research'))) as any;
    expect(row?.name).toBeTruthy();
    expect(listPlugins(db, env).installed).toBe(1);
  });

  it('重复安装不报错（幂等）', () => {
    expect(() => installPlugin(db, env, settings, 'deep-research')).not.toThrow();
    expect(listPlugins(db, env).installed).toBe(1);
  });

  it('停用后 enabled=false，再启用恢复', () => {
    const off = togglePlugin(db, env, settings, 'deep-research', false);
    expect(off.enabled).toBe(false);
    expect(listPlugins(db, env).plugins.find((p) => p.id === 'deep-research')?.enabled).toBe(false);
    const on = togglePlugin(db, env, settings, 'deep-research', true);
    expect(on.enabled).toBe(true);
  });

  it('卸载后目录与技能记录都清掉', () => {
    expect(uninstallPlugin(db, env, settings, 'deep-research')).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'skills', 'deep-research'))).toBe(false);
    const rows = db.prepare('SELECT * FROM skills').all() as any[];
    expect(rows.some((r) => String(r.dir).includes('deep-research'))).toBe(false);
    expect(listPlugins(db, env).installed).toBe(0);
  });

  it('未知插件抛错', () => {
    expect(() => installPlugin(db, env, settings, 'nope')).toThrow('插件不存在');
  });

  it('每个内置插件都有可用的 SKILL.md 内容', () => {
    for (const p of PLUGIN_CATALOG) {
      expect(p.skill.name.length).toBeGreaterThan(0);
      expect(p.skill.body.length).toBeGreaterThan(120);
      expect(p.highlights.length).toBeGreaterThan(0);
    }
  });
});
