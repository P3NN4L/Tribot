import fs from 'node:fs';
import path from 'node:path';

// ===== 从 GitHub 安装技能：扫描仓库里的 SKILL.md，逐个下载到 data/skills =====
// 只用公开 API（无 token 时限 60 次/小时，够手动扫描用）。

export interface GitHubSkill {
  id: string;
  name: string;
  description: string;
  /** 仓库内路径，例如 skills/pdf/SKILL.md */
  path: string;
  /** 安装时直接下载的原始地址 */
  raw: string;
  installed: boolean;
}

export interface GitHubScanResult {
  owner: string;
  repo: string;
  branch: string;
  skills: GitHubSkill[];
  truncated: boolean;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
}

export class GitHubError extends Error {}

// API 与 raw 都支持走镜像/代理（有些网络访问不了 api.github.com）
const API = process.env.TRIBOT_GITHUB_API || 'https://api.github.com';
const RAW = process.env.TRIBOT_GITHUB_RAW || 'https://raw.githubusercontent.com';

export function parseGitHubUrl(input: string): ParsedRepo {
  const raw = String(input ?? '').trim();
  if (!raw) throw new GitHubError('请输入 GitHub 仓库地址');
  // owner/repo 简写
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    const [owner, repo] = raw.split('/');
    return { owner, repo };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GitHubError('地址格式不对，示例：https://github.com/anthropics/skills');
  }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) throw new GitHubError('只支持 github.com 的仓库');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new GitHubError('地址里缺少仓库名');
  const [owner, repo] = parts;
  if (parts[2] === 'tree' && parts[3]) {
    return { owner, repo, branch: decodeURIComponent(parts[3]), subPath: parts.slice(4).join('/') };
  }
  return { owner, repo };
}

/** 极简 frontmatter 解析：只取 name / description，够技能市场用 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const out: { name?: string; description?: string } = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const head = m ? m[1] : text.slice(0, 2000);
  for (const line of head.split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    let v = kv[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[kv[1] as 'name' | 'description'] = v;
  }
  return out;
}

export function slugSkillId(input: string): string {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `skill-${Math.random().toString(36).slice(2, 6)}`;
}

async function ghFetch(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'TriBot-SkillMarket',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GitHubError('连不上 GitHub（api.github.com）。检查网络或代理，也可设 TRIBOT_GITHUB_API 指向镜像');
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new GitHubError(
      remaining === '0'
        ? 'GitHub 未登录限流（60 次/小时），过一会儿再试，或换小一点的仓库'
        : `GitHub 拒绝了请求（HTTP ${res.status}）`,
    );
  }
  if (res.status === 404) throw new GitHubError('仓库或分支不存在（私有仓库需要 token，暂不支持）');
  if (!res.ok) throw new GitHubError(`GitHub 返回 HTTP ${res.status}`);
  return res;
}

export async function scanGitHubSkills(input: string, installedIds: Set<string> = new Set()): Promise<GitHubScanResult> {
  const parsed = parseGitHubUrl(input);
  const meta = await (await ghFetch(`${API}/repos/${parsed.owner}/${parsed.repo}`)).json() as any;
  const branch = parsed.branch || meta.default_branch || 'main';
  const tree = await (await ghFetch(
    `${API}/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )).json() as any;
  if (!Array.isArray(tree.tree)) throw new GitHubError('读不到仓库文件树');

  const prefix = parsed.subPath ? `${parsed.subPath.replace(/\/+$/, '')}/` : '';
  const paths = (tree.tree as Array<{ path: string; type: string }>)
    .filter((n) => n.type === 'blob' && n.path.startsWith(prefix) && /(^|\/)SKILL\.md$/i.test(n.path))
    .slice(0, 60);

  const skills: GitHubSkill[] = [];
  for (const node of paths) {
    const raw = `${RAW}/${parsed.owner}/${parsed.repo}/${branch}/${node.path}`;
    let text = '';
    try {
      text = await (await fetch(raw, { signal: AbortSignal.timeout(15_000) })).text();
    } catch {
      continue;
    }
    const fm = parseSkillFrontmatter(text);
    const dir = node.path.replace(/\/?SKILL\.md$/i, '');
    const fallbackName = dir.split('/').pop() || parsed.repo;
    const id = slugSkillId(fm.name || fallbackName);
    skills.push({
      id,
      name: fm.name || fallbackName,
      description: fm.description || '',
      path: node.path,
      raw,
      installed: installedIds.has(id),
    });
  }
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    skills,
    truncated: tree.truncated === true,
  };
}

export async function installGitHubSkill(
  input: string,
  skillPath: string,
  dataDir: string,
): Promise<{ id: string; dir: string }> {
  const parsed = parseGitHubUrl(input);
  const res = await fetch(
    `${RAW}/${parsed.owner}/${parsed.repo}/${parsed.branch || 'main'}/${skillPath}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new GitHubError(`下载 SKILL.md 失败（HTTP ${res.status}）`);
  const text = await res.text();
  if (text.length > 400_000) throw new GitHubError('SKILL.md 太大（>400KB），拒绝安装');
  const fm = parseSkillFrontmatter(text);
  const dirName = skillPath.replace(/\/?SKILL\.md$/i, '').split('/').pop() || parsed.repo;
  const id = slugSkillId(fm.name || dirName);
  const dir = path.join(dataDir, 'skills', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text, 'utf8');
  return { id, dir };
}
