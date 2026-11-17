import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTriBot } from '../src/index';

/**
 * B1 回归测试：本地 server 的访问边界。
 * 1. 不带令牌调 /api/sessions → 401
 * 2. 带正确令牌 → 200
 * 3. /api/health 免令牌（供端口发现）
 * 4. 非本机 Origin 的 CORS 预检不发放 Allow-Origin（外站读不到响应）
 */

let tmpDir: string;
let app: Awaited<ReturnType<typeof buildTriBot>>;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-b1-'));
  process.env.TRIBOT_DATA_DIR = tmpDir;
  process.env.TRIBOT_MASTER_KEY = 'test-master-key-for-b1';
  app = await buildTriBot();
  await app.app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.app.close();
  delete process.env.TRIBOT_DATA_DIR;
  delete process.env.TRIBOT_MASTER_KEY;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function addr(): string {
  const a = app.app.server.address();
  if (!a || typeof a === 'string') throw new Error('no address');
  return `http://127.0.0.1:${a.port}`;
}

describe('本地访问边界（B1）', () => {
  it('没有令牌访问 /api/sessions 返回 401', async () => {
    const res = await fetch(`${addr()}/api/sessions`);
    expect(res.status).toBe(401);
  });

  it('带正确令牌可以访问', async () => {
    const res = await fetch(`${addr()}/api/sessions`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    expect(res.status).toBe(200);
  });

  it('/api/health 免令牌（端口发现用）', async () => {
    const res = await fetch(`${addr()}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it('外站 Origin 拿不到 Allow-Origin（跨站读不到响应）', async () => {
    const res = await fetch(`${addr()}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('本机 Origin 可以拿到 Allow-Origin', async () => {
    const origin = addr();
    const res = await fetch(`${addr()}/api/health`, { headers: { Origin: origin } });
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
  });
});
