import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import type { AppSettings, SkillMeta } from '@tribot/shared';
import type { Db } from '../db.js';
import type { EnvConfig } from '../config.js';
import { rowToSkill } from '../db.js';

// ===== Skill 加载器（开放 SKILL.md 格式，兼容 ZCode / Claude Code / 社区技能包）=====
// 格式：<目录>/SKILL.md，顶部 --- 包 YAML frontmatter（name/description/...），正文为指令。

export interface ParsedSkill {
  name?: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseSkillMd(text: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
  } catch {
    // frontmatter 解析失败就当没有，保留全文正文
    return { frontmatter: {}, body: text };
  }
  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : undefined,
    description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
    frontmatter,
    body: match[2],
  };
}

export function defaultSkillDirs(env: EnvConfig): string[] {
  const dirs = [path.join(env.dataDir, 'skills')];
  // ZCode 全局技能目录（存在才收）
  const zcode = path.join(os.homedir(), '.zcode', 'skills');
  if (fs.existsSync(zcode)) dirs.push(zcode);
  const local = path.join(env.root, 'skills');
  if (fs.existsSync(local)) dirs.push(local);
  return dirs;
}

export function effectiveSkillDirs(env: EnvConfig, settings: AppSettings): string[] {
  const set = new Set<string>([...defaultSkillDirs(env), ...(settings.skillDirs ?? [])]);
  return [...set].filter((d) => {
    try {
      return fs.existsSync(d) && fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

/** 递归找含 SKILL.md 的目录（跳过 node_modules/.git，最多 3 层） */
function findSkillDirs(root: string, maxDepth = 3, depth = 0, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  if (entries.some((e) => e.isFile() && /^skill\.md$/i.test(e.name))) {
    acc.push(root);
    return acc; // 该目录本身是技能，不再深入
  }
  if (depth >= maxDepth) return acc;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
    findSkillDirs(path.join(root, e.name), maxDepth, depth + 1, acc);
  }
  return acc;
}

export function scanSkills(db: Db, env: EnvConfig, settings: AppSettings): SkillMeta[] {
  const dirs = effectiveSkillDirs(env, settings);
  const found: Array<{ dir: string; name: string; description: string; hasScripts: boolean; source: string }> = [];
  const seenDirs = new Set<string>();
  for (const sourceDir of dirs) {
    for (const skillDir of findSkillDirs(sourceDir)) {
      const norm = path.normalize(skillDir);
      if (seenDirs.has(norm)) continue;
      seenDirs.add(norm);
      try {
        const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
        const parsed = parseSkillMd(raw);
        const folderName = path.basename(skillDir);
        const name = parsed.name || folderName;
        const description =
          parsed.description ||
          parsed.body.trim().split(/\r?\n/).find((l) => l.trim())?.slice(0, 200) ||
          folderName;
        const hasScripts = fs.existsSync(path.join(skillDir, 'scripts'));
        found.push({ dir: norm, name, description: description.slice(0, 500), hasScripts, source: sourceDir });
      } catch {
        // 读取失败（编码等）跳过
      }
    }
  }

  const existing = new Map<string, any>();
  for (const row of db.prepare('SELECT * FROM skills').all() as any[]) existing.set(path.normalize(row.dir), row);

  // 以数据库里已占用的 id 为基准去重：不同目录可能同名（例如两个 hello-demo）
  const takenIds = new Set<string>([...existing.values()].map((r) => String(r.id)));
  for (const f of found) {
    const prev = existing.get(f.dir);
    let id: string;
    if (prev) {
      id = String(prev.id);
    } else {
      const base = path.basename(f.dir);
      id = base;
      let n = 2;
      while (takenIds.has(id)) id = `${base}-${n++}`;
    }
    takenIds.add(id);
    if (prev) {
      db.prepare('UPDATE skills SET name=?, description=?, has_scripts=?, source=?, id=? WHERE dir=?').run(
        f.name, f.description, f.hasScripts ? 1 : 0, f.source, id, f.dir,
      );
    } else {
      db.prepare(
        'INSERT INTO skills(id, name, description, dir, source, enabled, has_scripts) VALUES(?,?,?,?,?,1,?)',
      ).run(id, f.name, f.description, f.dir, f.source, f.hasScripts ? 1 : 0);
    }
  }
  // 清理已消失的目录
  const foundSet = new Set(found.map((f) => f.dir));
  for (const [dir, row] of existing) {
    if (!foundSet.has(dir)) db.prepare('DELETE FROM skills WHERE dir = ?').run(row.dir);
  }
  return (db.prepare('SELECT * FROM skills ORDER BY name').all() as any[]).map(rowToSkill);
}

/** 按名字或 id 读取技能正文（每次现读文件，技能更新即时生效） */
export function loadSkillBody(db: Db, nameOrId: string): Promise<string> {
  const row = db
    .prepare('SELECT * FROM skills WHERE enabled = 1 AND (name = ? OR id = ?) ORDER BY dir LIMIT 1')
    .get(nameOrId, nameOrId) as any;
  if (!row) return Promise.resolve('');
  try {
    const raw = fs.readFileSync(path.join(row.dir, 'SKILL.md'), 'utf8');
    const parsed = parseSkillMd(raw);
    const head = `# 技能：${row.name}\n${row.description}\n\n`;
    return Promise.resolve(head + parsed.body.trim());
  } catch {
    return Promise.resolve('');
  }
}
