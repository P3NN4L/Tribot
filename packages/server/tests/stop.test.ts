import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTriBot } from '../src/index';

/**
 * POST /api/sessions/:id/stop 的两条用例（不调真实模型）：
 * 1. 空闲会话 stop → { ok: false }
 * 2. 生成中 stop → abort 生效：ok:true，SSE 流快速收尾（done），上游假 OpenAI 连接被释放
 * 本地 http 假 OpenAI SSE 服务器替代真实 LLM；TRIBOT_DATA_DIR 指向临时目录，不碰真实 data/。
 */

const FAKE_PORT = 48999;
let fakeSrv: http.Server;
let fakeClosed = false;
let fakeChunks = 0;
let tmpDir: string;

/** OpenAI 兼容 SSE：每 30ms 发一个 delta，共 200 块（约 6s），客户端 abort 会触发 close */
function startFakeOpenAI(port: number): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    let i = 0;
    const timer = setInterval(() => {
      if (i < 200) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: `字${i} ` }, finish_reason: null }] })}\n\n`);
        i += 1;
        fakeChunks = i;
      } else {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 200 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        clearInterval(timer);
        res.end();
      }
    }, 30);
    res.on('close', () => { clearInterval(timer); fakeClosed = true; });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-stop-test-'));
  process.env.TRIBOT_DATA_DIR = tmpDir;
  fakeSrv = await startFakeOpenAI(FAKE_PORT);
});

afterAll(async () => {
  fakeSrv?.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('POST /api/sessions/:id/stop', () => {
  it('空闲会话：返回 ok:false', { timeout: 20_000 }, async () => {
    const t = await buildTriBot();
    try {
      const created = await t.app.inject({ method: 'POST', url: '/api/sessions', payload: { title: 'stop-test', type: 'chat' } });
      const sid = created.json().session.id;
      const res = await t.app.inject({ method: 'POST', url: `/api/sessions/${sid}/stop` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.note).toEqual(expect.any(String));
    } finally {
      (t.scheduler as any)?.stop?.();
      await t.app.close();
    }
  });

  it('生成中：stop 触发 abort，流快速收尾且上游连接释放（不调真实模型）', { timeout: 20_000 }, async () => {
    const t = await buildTriBot();
    try {
      // 把 glm 凭证指到本地假 OpenAI（apiKey 随便，假服务器不校验）
      const put = await t.app.inject({
        method: 'PUT', url: '/api/credentials/glm',
        payload: { apiKey: 'test-fake-key', baseURL: `http://127.0.0.1:${FAKE_PORT}` },
      });
      expect(put.statusCode).toBe(200);

      const created = await t.app.inject({ method: 'POST', url: '/api/sessions', payload: { title: 'stop-stream', type: 'chat' } });
      const sid = created.json().session.id;

      // 真实 HTTP 监听（SSE + hijack 走不了 inject）
      await t.app.listen({ port: 0, host: '127.0.0.1' });
      const base = `http://127.0.0.1:${(t.app.server.address() as any).port}`;

      const res = await fetch(`${base}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ sessionId: sid, content: '随便说点什么', mode: 'manual', model: 'glm-5.3', thinking: 'fast' }),
      });
      expect(res.ok).toBe(true);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const events: any[] = [];

      // 阶段一：读到第一个 token（证明生成中）
      let sawToken = false;
      while (!sawToken) {
        const { value, done } = await Promise.race([reader.read(), sleep(8_000).then(() => { throw new Error('8s 内没收到任何 token'); })]);
        if (done) throw new Error('流提前结束，没进入生成状态');
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
        }
        sawToken = events.some((e) => e.type === 'token' || e.type === 'delta');
      }
      expect(sawToken).toBe(true);

      // 阶段二：stop → ok:true
      const stopAt = Date.now();
      const stop = await t.app.inject({ method: 'POST', url: `/api/sessions/${sid}/stop` });
      expect(stop.statusCode).toBe(200);
      expect(stop.json().ok).toBe(true);

      // 阶段三：流应在远小于自然时长（约 6s）内收尾
      let sawDone = false;
      while (!sawDone) {
        const { value, done } = await Promise.race([reader.read(), sleep(8_000).then(() => { throw new Error('stop 后 8s 流仍未结束'); })]);
        if (value) {
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
          }
        }
        sawDone = done || events.some((e) => e.type === 'done');
      }
      const elapsed = Date.now() - stopAt;
      expect(events.some((e) => e.type === 'done')).toBe(true);
      expect(elapsed).toBeLessThan(3_000); // 自然跑完要 ~6s；abort 生效应 <3s
      // 上游连接被释放（客户端 abort 传导到假 OpenAI）
      await sleep(300);
      expect(fakeClosed).toBe(true);
    } finally {
      (t.scheduler as any)?.stop?.();
      await t.app.close();
    }
  });
});
