import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, PluginCatalog, PluginCategory, PluginInfo } from '@tribot/shared';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import { scanSkills } from '../skills/loader.js';
import { PLUGIN_CATALOG, type PluginSeed } from './catalog.js';

// ===== 插件市场：安装 = 往 data/skills/<id>/ 写一个 SKILL.md =====

export const CATEGORY_LABELS: Record<PluginCategory, string> = {
  research: '调研',
  writing: '写作',
  engineering: '工程',
  data: '数据',
  ops: '运维',
};

export function pluginSkillDir(env: EnvConfig, id: string): string {
  return path.join(env.dataDir, 'skills', id);
}

function toInfo(seed: PluginSeed, installedRow: any | undefined): PluginInfo {
  return {
    id: seed.id,
    name: seed.name,
    author: seed.author,
    version: seed.version,
    category: seed.category,
    description: seed.description,
    tags: seed.tags,
    highlights: seed.highlights,
    kind: 'skill',
    installed: !!installedRow,
    enabled: installedRow ? !!installedRow.enabled : false,
    installs: seed.installs,
    skillId: installedRow?.id,
    bytes: seed.skill.body.length,
  };
}

export function listPlugins(db: Db, env: EnvConfig): PluginCatalog {
  const rows = db.prepare('SELECT * FROM skills').all() as any[];
  const byDir = new Map(rows.map((r) => [path.normalize(r.dir), r]));
  const plugins = PLUGIN_CATALOG.map((seed) =>
    toInfo(seed, byDir.get(path.normalize(pluginSkillDir(env, seed.id)))),
  );
  const counts = new Map<PluginCategory, number>();
  for (const p of plugins) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return {
    plugins,
    installed: plugins.filter((p) => p.installed).length,
    categories: (Object.keys(CATEGORY_LABELS) as PluginCategory[])
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => ({ id: c, label: CATEGORY_LABELS[c], count: counts.get(c)! })),
  };
}

export function installPlugin(db: Db, env: EnvConfig, settings: AppSettings, id: string): PluginInfo {
  const seed = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!seed) throw new Error('插件不存在');
  const dir = pluginSkillDir(env, id);
  fs.mkdirSync(dir, { recursive: true });
  const md = [
    '---',
    `name: ${seed.skill.name}`,
    `description: ${seed.skill.description}`,
    `version: ${seed.version}`,
    `source: market/${seed.id}`,
    '---',
    '',
    seed.skill.body,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf8');
  scanSkills(db, env, settings);
  const row = db.prepare('SELECT * FROM skills WHERE dir = ?').get(path.normalize(dir)) as any;
  return toInfo(seed, row);
}

export function uninstallPlugin(db: Db, env: EnvConfig, settings: AppSettings, id: string): boolean {
  const seed = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!seed) throw new Error('插件不存在');
  const dir = pluginSkillDir(env, id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    return false;
  }
  scanSkills(db, env, settings);
  return true;
}

export function togglePlugin(db: Db, env: EnvConfig, settings: AppSettings, id: string, enabled: boolean): PluginInfo {
  const seed = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!seed) throw new Error('插件不存在');
  const dir = path.normalize(pluginSkillDir(env, id));
  const row = db.prepare('SELECT * FROM skills WHERE dir = ?').get(dir) as any;
  if (!row) throw new Error('插件尚未安装');
  db.prepare('UPDATE skills SET enabled = ? WHERE dir = ?').run(enabled ? 1 : 0, dir);
  void settings;
  return toInfo(seed, { ...row, enabled: enabled ? 1 : 0 });
}
