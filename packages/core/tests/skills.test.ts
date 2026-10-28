import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../src/db.js';
import { parseSkillMd, scanSkills, loadSkillBody } from '../src/skills/loader.js';
import { DEFAULT_SETTINGS } from '@tribot/shared';
import type { Db } from '../src/db.js';

const SAMPLE = `---
name: pdf-report
description: 生成 PDF 报告的技能
when_to_use: 用户要导出 PDF 时
---

# 步骤
1. 先确认字体
2. 用模板渲染
`;

describe('parseSkillMd（开放 SKILL.md 格式）', () => {
  it('解析 frontmatter 与正文', () => {
    const p = parseSkillMd(SAMPLE);
    expect(p.name).toBe('pdf-report');
    expect(p.description).toBe('生成 PDF 报告的技能');
    expect(p.body).toContain('# 步骤');
    expect(p.frontmatter.when_to_use).toBe('用户要导出 PDF 时');
  });
  it('没有 frontmatter 时退化为纯正文', () => {
    const p = parseSkillMd('# 直接正文\n内容');
    expect(p.body).toContain('直接正文');
    expect(p.name).toBeUndefined();
  });
});

describe('scanSkills / loadSkillBody', () => {
  let db: Db;
  let tmp: string;
  let dataDir: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-skills-'));
    // 模拟一个技能包目录
    fs.mkdirSync(path.join(tmp, 'skills', 'pdf-report'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 'pdf-report', 'SKILL.md'), SAMPLE);
    // 嵌套一层的技能目录也应被找到
    fs.mkdirSync(path.join(tmp, 'skills', 'cat', 'web-scraper'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'skills', 'cat', 'web-scraper', 'SKILL.md'),
      '---\nname: web-scraper\ndescription: 抓取网页\n---\n抓取步骤…',
    );
    dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    db = openDb(dataDir);
  });

  it('扫描并登记技能（含嵌套目录）', () => {
    const metas = scanSkills(db, {
      root: tmp, dataDir, port: 1, packaged: false, keys: {},
    }, { ...DEFAULT_SETTINGS, skillDirs: [path.join(tmp, 'skills')] });
    const names = metas.map((m) => m.name);
    expect(names).toContain('pdf-report');
    expect(names).toContain('web-scraper');
  });

  it('按名字加载正文', async () => {
    const body = await loadSkillBody(db, 'pdf-report');
    expect(body).toContain('先确认字体');
  });

  it('禁用后加载不到', async () => {
    db.prepare("UPDATE skills SET enabled = 0 WHERE name = 'pdf-report'").run();
    const body = await loadSkillBody(db, 'pdf-report');
    expect(body).toBe('');
  });

  afterAll(() => {
    try { db.close(); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
