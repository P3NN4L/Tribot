import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProviderId } from '@tribot/shared';
import type { EnvConfig } from './config.js';
import { maskKey } from './config.js';
import { decryptSecret, encryptSecret, isEncryptedSecret, masterKeyFromEnv } from './secret.js';

// ===== 凭证文件（对齐 DeepSeek Harness 的做法）=====
// 不复用 .env：Key 单独存在 data/credentials.json，只回显尾号，可随时改 baseURL / 清除。
// .env 仍然兼容（作为兜底来源），凭证文件优先。

export type CredentialId = ProviderId | 'tavily';

export interface ProviderCredential {
  apiKey?: string;
  baseURL?: string;
  updatedAt?: string;
}

export interface CredentialsFile {
  version: 1;
  providers: Partial<Record<ProviderId, ProviderCredential>>;
  tools?: { tavily?: ProviderCredential };
}

export const EMPTY_CREDENTIALS: CredentialsFile = { version: 1, providers: {}, tools: {} };

export function credentialsPath(dataDir: string): string {
  return path.join(dataDir, 'credentials.json');
}

/** 纯 Node 运行时（没有 Electron safeStorage）的兜底主密钥文件 */
function localKeyPath(dataDir: string): string {
  return path.join(dataDir, '.localkey');
}

function readLocalKey(dataDir: string): Buffer | null {
  try {
    const k = Buffer.from(fs.readFileSync(localKeyPath(dataDir), 'utf8').trim(), 'base64');
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

function ensureLocalKey(dataDir: string): Buffer {
  const existing = readLocalKey(dataDir);
  if (existing) return existing;
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(localKeyPath(dataDir), `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 });
  return key;
}

export function loadCredentials(dataDir: string): CredentialsFile {
  let raw: Partial<CredentialsFile>;
  try {
    raw = JSON.parse(fs.readFileSync(credentialsPath(dataDir), 'utf8')) as Partial<CredentialsFile>;
  } catch {
    return { version: 1, providers: {}, tools: {} };
  }
  const envKey = masterKeyFromEnv();
  const localKey = readLocalKey(dataDir);
  const candidates: Buffer[] = [];
  if (envKey) candidates.push(envKey);
  if (localKey && (!envKey || !localKey.equals(envKey))) candidates.push(localKey);
  let usedLocal = false;
  const open = (cred?: ProviderCredential): ProviderCredential | undefined => {
    if (!cred) return cred;
    if (!isEncryptedSecret(cred.apiKey)) return cred;
    for (const k of candidates) {
      try {
        const apiKey = decryptSecret(cred.apiKey!, k);
        if (!envKey || !k.equals(envKey)) usedLocal = true;
        return { ...cred, apiKey };
      } catch {
        /* 换下一个候选密钥 */
      }
    }
    // 主密钥换了 / 文件被改过：当作没有 Key，避免把密文当 Key 发出去
    return { ...cred, apiKey: '' };
  };
  const providers: CredentialsFile['providers'] = {};
  for (const [id, cred] of Object.entries(raw.providers ?? {})) {
    providers[id] = open(cred as ProviderCredential)!;
  }
  const result: CredentialsFile = {
    version: 1,
    providers,
    tools: { tavily: open(raw.tools?.tavily) ?? undefined },
  };
  // 原来用本机兜底密钥加密、现在有了 Electron/DPAPI 主密钥：顺手迁移
  if (usedLocal && envKey) {
    try { saveCredentials(dataDir, result); } catch { /* ignore */ }
  }
  return result;
}

export function saveCredentials(dataDir: string, creds: CredentialsFile): void {
  const key = masterKeyFromEnv() ?? ensureLocalKey(dataDir);
  const seal = (cred?: ProviderCredential): ProviderCredential | undefined => {
    if (!cred) return cred;
    if (!cred.apiKey || isEncryptedSecret(cred.apiKey)) return cred;
    return { ...cred, apiKey: encryptSecret(cred.apiKey, key) };
  };
  const providers: CredentialsFile['providers'] = {};
  for (const [id, cred] of Object.entries(creds.providers ?? {})) {
    providers[id] = seal(cred as ProviderCredential)!;
  }
  const next: CredentialsFile = {
    version: 1,
    providers,
    tools: { tavily: seal(creds.tools?.tavily) ?? undefined },
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(credentialsPath(dataDir), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/** 是否正在使用加密（有 Electron 主密钥或本机兜底密钥） */
export function credentialsEncrypted(dataDir?: string): boolean {
  return !!masterKeyFromEnv() || (!!dataDir && !!readLocalKey(dataDir));
}

/** 文件里是否还有明文 apiKey（启动迁移只在需要时执行，避免解密失败把 Key 写没） */
export function credentialsNeedEncryption(dataDir: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath(dataDir), 'utf8')) as CredentialsFile;
    const check = (cred?: ProviderCredential) => !!cred?.apiKey && !isEncryptedSecret(cred.apiKey);
    for (const cred of Object.values(raw.providers ?? {})) if (check(cred)) return true;
    return check(raw.tools?.tavily);
  } catch {
    return false;
  }
}

export function getCredential(creds: CredentialsFile, id: CredentialId): ProviderCredential | undefined {
  return id === 'tavily' ? creds.tools?.tavily : creds.providers[id];
}

export function setCredential(
  creds: CredentialsFile,
  id: CredentialId,
  patch: { apiKey?: string | null; baseURL?: string | null },
): CredentialsFile {
  const next: CredentialsFile = {
    version: 1,
    providers: { ...creds.providers },
    tools: { ...(creds.tools ?? {}) },
  };
  const current = getCredential(next, id) ?? {};
  const merged: ProviderCredential = { ...current, updatedAt: new Date().toISOString() };
  if (patch.apiKey !== undefined) {
    if (patch.apiKey) merged.apiKey = patch.apiKey.trim();
    else delete merged.apiKey;
  }
  if (patch.baseURL !== undefined) {
    if (patch.baseURL) merged.baseURL = patch.baseURL.trim().replace(/\/+$/, '');
    else delete merged.baseURL;
  }
  if (id === 'tavily') next.tools = { ...(next.tools ?? {}), tavily: merged };
  else next.providers[id] = merged;
  return next;
}

/**
 * 把凭证应用到运行时环境：凭证文件 > .env / process.env（baseKeys 是启动时的兜底值）。
 * 清空凭证后会退回 .env 里的值，不会把用户的 .env 配置弄丢。
 */
export function applyCredentials(
  env: EnvConfig,
  creds: CredentialsFile,
  baseKeys: Partial<Record<string, string>>,
): void {
  const ids = new Set<string>(['glm', 'minimax', 'deepseek', 'tavily']);
  for (const id of Object.keys(creds.providers ?? {})) ids.add(id);
  for (const id of Object.keys(baseKeys ?? {})) ids.add(id);
  for (const id of ids) {
    const cred = getCredential(creds, id);
    const effective = cred?.apiKey || baseKeys[id];
    if (effective) env.keys[id] = effective;
    else delete env.keys[id];
  }
}

export interface CredentialView {
  id: CredentialId;
  label: string;
  billing: 'subscription' | 'payg' | 'tool';
  defaultBaseURL: string;
  baseURL: string;
  hasKey: boolean;
  hint: string | null;
  source: 'credentials' | 'env' | 'none';
  models: number;
}

export function credentialView(args: {
  id: CredentialId;
  label: string;
  billing: CredentialView['billing'];
  defaultBaseURL: string;
  cred?: ProviderCredential;
  envKey?: string;
  models: number;
}): CredentialView {
  const { id, label, billing, defaultBaseURL, cred, envKey, models } = args;
  const hasCred = !!cred?.apiKey;
  return {
    id,
    label,
    billing,
    defaultBaseURL,
    baseURL: cred?.baseURL ?? defaultBaseURL,
    hasKey: hasCred || !!envKey,
    hint: maskKey(cred?.apiKey || envKey),
    source: hasCred ? 'credentials' : envKey ? 'env' : 'none',
    models,
  };
}
