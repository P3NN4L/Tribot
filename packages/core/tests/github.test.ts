import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GitHubError, installGitHubSkill, parseGitHubUrl, parseSkillFrontmatter,
  scanGitHubSkills, slugSkillId,
} from '../src/plugins/github.js';

describe('GitHub 地址解析', () => {
  it('完整仓库地址', () => {
    expect(parseGitHubUrl('https://github.com/anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' });
  });

  it('带分支和子目录', () => {
    expect(parseGitHubUrl('https://github.com/anthropics/skills/tree/main/skills/pdf'))
      .toEqual({ owner: 'anthropics', repo: 'skills', branch: 'main', subPath: 'skills/pdf' });
  });

  it('owner/repo 简写', () => {
    expect(parseGitHubUrl('Nutlope/hallmark')).toEqual({ owner: 'Nutlope', repo: 'hallmark' });
  });

  it('非 GitHub 地址直接拒绝', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/a/b')).toThrow(GitHubError);
    expect(() => parseGitHubUrl('not a url')).toThrow(GitHubError);
  });
});

describe('SKILL.md frontmatter', () => {
  it('提取 name 与 description', () => {
    const text = [
      '---',
      'name: design-system',
      'description: "三层 token 的设计系统规范"',
      '---',
      '# 标题',
    ].join('\n');
    expect(parseSkillFrontmatter(text)).toEqual({
      name: 'design-system',
      description: '三层 token 的设计系统规范',
    });
  });

  it('没有 frontmatter 时返回空对象', () => {
    expect(parseSkillFrontmatter('# 只有正文')).toEqual({});
  });
});

describe('技能 id 生成', () => {
  it('保留字母数字与中文，其余变连字符', () => {
    expect(slugSkillId('PDF Tool')).toBe('pdf-tool');
    expect(slugSkillId('设计系统')).toBe('设计系统');
    expect(slugSkillId('  ')).toMatch(/^skill-/);
  });
});

// ===== 扫描与安装（mock fetch，不依赖真实网络）=====

const json = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
const text = (s: string) => new Response(s, { status: 200, headers: { 'content-type': 'text/plain' } });

afterEach(() => vi.unstubAllGlobals());

describe('扫描 GitHub 仓库', () => {
  it('从文件树里找到 SKILL.md 并解析出技能', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/repos/acme/skills')) return json({ default_branch: 'main' });
      if (url.includes('/git/trees/main')) {
        return json({
          truncated: false,
          tree: [
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
            { path: 'skills/beta/SKILL.md', type: 'blob' },
            { path: 'README.md', type: 'blob' },
          ],
        });
      }
      if (url.includes('/skills/alpha/SKILL.md')) return text('---\nname: Alpha\ndescription: 演示技能 A\n---\n');
      return text('---\nname: Beta\ndescription: 演示技能 B\n---\n');
    }));

    const result = await scanGitHubSkills('https://github.com/acme/skills', new Set(['beta']));
    expect(result.repo).toBe('skills');
    expect(result.branch).toBe('main');
    expect(result.skills.map((s) => s.id)).toEqual(['alpha', 'beta']);
    expect(result.skills[0].description).toBe('演示技能 A');
    expect(result.skills[0].installed).toBe(false);
    expect(result.skills[1].installed).toBe(true);
  });

  it('连不上时给出可操作的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(scanGitHubSkills('acme/skills')).rejects.toThrow('连不上 GitHub');
  });
});

describe('安装技能', () => {
  it('把 SKILL.md 写进 data/skills/<id>/', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-gh-'));
    vi.stubGlobal('fetch', vi.fn(async () => text('---\nname: My Skill\ndescription: 测试\n---\n# 正文')));
    const r = await installGitHubSkill('acme/skills', 'skills/foo/SKILL.md', tmp);
    expect(r.id).toBe('my-skill');
    const saved = fs.readFileSync(path.join(tmp, 'skills/my-skill/SKILL.md'), 'utf8');
    expect(saved).toContain('# 正文');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
