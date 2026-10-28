import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EMPTY_CREDENTIALS, applyCredentials, credentialView, credentialsPath, getCredential, loadCredentials,
  saveCredentials, setCredential,
} from '../src/credentials.js';
import type { EnvConfig } from '../src/config.js';

// ===== 凭证文件：独立于 .env、只回显尾号、清空后回退 .env =====

function makeEnv(): EnvConfig {
  return {
    root: 'C:/tmp/tribot', dataDir: 'C:/tmp/tribot/data', port: 1, packaged: false,
    keys: { deepseek: 'from-env-deepseek' },
  } as unknown as EnvConfig;
}

describe('凭证存储', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-cred-'));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('读写往返，保留 baseURL 与 apiKey', () => {
    let creds = { ...EMPTY_CREDENTIALS };
    creds = setCredential(creds, 'glm', { apiKey: 'glm-key-123456789', baseURL: 'https://proxy.example.com/v1/' });
    saveCredentials(tmp, creds);
    const back = loadCredentials(tmp);
    expect(back.providers.glm?.apiKey).toBe('glm-key-123456789');
    expect(back.providers.glm?.baseURL).toBe('https://proxy.example.com/v1'); // 去掉尾部斜杠
    expect(getCredential(back, 'glm')?.apiKey).toBe('glm-key-123456789');
  });

  it('只回显尾号，绝不回传明文', () => {
    const creds = { ...EMPTY_CREDENTIALS, providers: { deepseek: { apiKey: 'sk-abcdefghijklmnop' } } };
    const v = credentialView({
      id: 'deepseek', label: 'DeepSeek', billing: 'payg', defaultBaseURL: 'https://api.deepseek.com/v1',
      cred: creds.providers.deepseek, models: 2,
    });
    expect(v.hint).toBe('…mnop');
    expect(JSON.stringify(v)).not.toContain('sk-abcdefghijklmnop');
  });

  it('清空凭证后退回 .env 的 Key', () => {
    const env = makeEnv();
    const baseKeys = { deepseek: 'from-env-deepseek' };

    applyCredentials(env, { ...EMPTY_CREDENTIALS, providers: { deepseek: { apiKey: 'from-cred-file' } } }, baseKeys);
    expect(env.keys.deepseek).toBe('from-cred-file');

    applyCredentials(env, { ...EMPTY_CREDENTIALS }, baseKeys);
    expect(env.keys.deepseek).toBe('from-env-deepseek');
  });

  it('没有凭证也没有 .env 时清空运行时 Key', () => {
    const env = makeEnv();
    applyCredentials(env, { ...EMPTY_CREDENTIALS }, {});
    expect(env.keys.deepseek).toBeUndefined();
  });

  it('tavily 作为工具凭证单独存', () => {
    let creds = setCredential({ ...EMPTY_CREDENTIALS }, 'tavily', { apiKey: 'tvly-1234567890' });
    expect(creds.tools?.tavily?.apiKey).toBe('tvly-1234567890');
    expect(creds.providers.tavily).toBeUndefined();
    const view = credentialView({
      id: 'tavily', label: 'Tavily', billing: 'tool', defaultBaseURL: 'https://api.tavily.com',
      cred: creds.tools?.tavily, models: 0,
    });
    expect(view.source).toBe('credentials');
    expect(view.baseURL).toBe('https://api.tavily.com');
  });

  it('文件不存在时返回空结构，不抛错', () => {
    const fresh = path.join(tmp, 'nope');
    expect(loadCredentials(fresh)).toEqual({ version: 1, providers: {}, tools: {} });
  });
});

describe('凭证加密（AES-256-GCM）', () => {
  let tmp: string;
  const KEY = crypto.randomBytes(32);

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-cred-enc-'));
    process.env.TRIBOT_MASTER_KEY = KEY.toString('base64');
  });
  afterAll(() => {
    delete process.env.TRIBOT_MASTER_KEY;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('落盘是密文，读回是明文', () => {
    const creds = setCredential(EMPTY_CREDENTIALS, 'glm', { apiKey: 'sk-secret-123456' });
    saveCredentials(tmp, creds);
    const raw = fs.readFileSync(credentialsPath(tmp), 'utf8');
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('sk-secret-123456');
    expect(loadCredentials(tmp).providers.glm?.apiKey).toBe('sk-secret-123456');
  });

  it('换主密钥后解不开，按未配置处理', () => {
    process.env.TRIBOT_MASTER_KEY = crypto.randomBytes(32).toString('base64');
    expect(loadCredentials(tmp).providers.glm?.apiKey).toBe('');
  });
});