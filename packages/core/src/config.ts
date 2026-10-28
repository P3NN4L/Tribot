import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface EnvConfig {
  root: string; // 项目根（开发模式）或应用数据目录（打包模式）
  dataDir: string;
  port: number;
  packaged: boolean;
  /** 内置三家 + 任意自定义供应商，键是 provider id */
  keys: Record<string, string | undefined>;
}

/** provider → .env 里的变量名（设置页填 Key 走这套映射） */
export const KEY_ENV_MAP = {
  glm: 'TRIBOT_GLM_API_KEY',
  minimax: 'TRIBOT_MINIMAX_API_KEY',
  deepseek: 'TRIBOT_DEEPSEEK_API_KEY',
  tavily: 'TRIBOT_TAVILY_API_KEY',
} as const;

export type KeyProvider = keyof typeof KEY_ENV_MAP;

/** 只回显尾部 4 位，前端拿不到完整 Key */
export function maskKey(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return '已配置';
  return `…${value.slice(-4)}`;
}

/** 写回项目根 .env（保留注释与其他行），同时更新进程内 env 和 process.env */
export function setEnvKey(envFileRoot: string, env: EnvConfig, provider: KeyProvider, value: string): EnvConfig {
  const name = KEY_ENV_MAP[provider];
  const trimmed = value.trim();
  const file = path.join(envFileRoot, '.env');
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    lines = ['# TriBot local config (written by Settings UI)'];
  }
  const next: string[] = [];
  let done = false;
  for (const line of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && m[1] === name) {
      if (trimmed) next.push(`${name}=${trimmed}`);
      done = true;
      continue; // 空值 = 删除这一行
    }
    next.push(line);
  }
  if (!done && trimmed) {
    while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
    next.push(`${name}=${trimmed}`, '');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');

  if (trimmed) {
    process.env[name] = trimmed;
    env.keys[provider] = trimmed;
  } else {
    delete process.env[name];
    delete env.keys[provider];
  }
  cached = env;
  return env;
}

function parseEnvFile(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out.push([key, val]);
  }
  return out;
}

function findProjectRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

let cached: EnvConfig | undefined;

export function loadEnv(force = false): EnvConfig {
  if (cached && !force) return cached;
  const packaged = process.env.TRIBOT_PACKAGED === '1';
  let root = process.env.TRIBOT_ROOT;
  if (!root) {
    if (packaged) {
      root = path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'TriBot',
      );
    } else {
      root = findProjectRoot(process.cwd()) ?? process.cwd();
    }
  }

  // 读取项目根的 .env（不覆盖已存在的环境变量）
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    for (const [k, v] of parseEnvFile(fs.readFileSync(envFile, 'utf8'))) {
      if (!process.env[k]) process.env[k] = v;
    }
  }

  const dataDir = process.env.TRIBOT_DATA_DIR || path.join(root, 'data');
  const port = Number(process.env.TRIBOT_PORT || 47615);
  cached = {
    root,
    dataDir,
    port: Number.isFinite(port) && port > 0 ? port : 47615,
    packaged,
    keys: {
      glm: process.env.TRIBOT_GLM_API_KEY || undefined,
      minimax: process.env.TRIBOT_MINIMAX_API_KEY || undefined,
      deepseek: process.env.TRIBOT_DEEPSEEK_API_KEY || undefined,
      tavily: process.env.TRIBOT_TAVILY_API_KEY || undefined,
    },
  };
  return cached;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
