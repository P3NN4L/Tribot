import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { AppSettings, ChatRequest, StreamEvent } from '@tribot/shared';
import { DEFAULT_SETTINGS } from '@tribot/shared';
import {
  DEFAULT_MODELS, ModelRegistry, PROVIDER_DEFS, RoutineScheduler, applyCredentials, buildContextInsight,
  chatStream,
  compactSession, createRoutineWithSession, createSession, credentialView, credentialsPath, credentialsNeedEncryption, defaultTaskWorkspace, deepseekPeriod,
  dropSessionGrants, getBot, getSetting, installPlugin, listBots, listCheckpoints, listMessages, listPlugins, loadCredentials,
  loadEnv, nowIso, openDb, quotaDashboardCached, resolveApproval, restoreCheckpoint, rowToRoutine, rowToSession, rowToSkill, runChat,
  saveCredentials, scanSkills, seedBots, setCredential, setSetting, togglePlugin, touchSession, uninstallPlugin, validateCron,
  loadCustomProviders, saveCustomProviders, normalizeProvider, upsertCustomProvider, removeCustomProvider,
  scanGitHubSkills, installGitHubSkill,
  parseSkinDataUrl, safeSkinName, skinContentType,
  summarizeSessionUsage, PROVIDER_PRESETS,
  withGrant, withoutGrant, type ContextDeps, type CredentialId, type CredentialView, type CredentialsFile,
  type EngineContext,
} from '@tribot/core';
import type { ProviderId } from '@tribot/shared';

const VERSION = '0.1.0';

/** 用表单里（可能还没保存）的值测一次连通性 */
async function testCredential(
  id: CredentialId,
  apiKeyIn?: string,
  baseURLIn?: string,
  baseURLFallback?: string,
  modelFallback?: string,
): Promise<{
  ok: boolean; ms: number; message: string; models?: number;
}> {
  const env = loadEnv();
  const creds = loadCredentials(env.dataDir);
  const stored = id === 'tavily' ? creds.tools?.tavily : creds.providers[id];
  const key = (apiKeyIn ?? '').trim() || stored?.apiKey || env.keys[id];
  if (!key) return { ok: false, ms: 0, message: '还没有填 API Key' };
  const base = (
    (baseURLIn ?? '').trim()
    || stored?.baseURL
    || baseURLFallback
    || (id === 'tavily' ? 'https://api.tavily.com' : PROVIDER_DEFS[id as 'glm']?.baseURL)
    || ''
  ).replace(/\/+$/, '');
  if (!base) return { ok: false, ms: 0, message: 'Base URL 为空' };
  const started = Date.now();
  const timeout = () => AbortSignal.timeout(15_000);

  try {
    if (id === 'tavily') {
      const res = await fetch(`${base}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: 'ping', max_results: 1, search_depth: 'basic' }),
        signal: timeout(),
      });
      const ms = Date.now() - started;
      if (res.ok) return { ok: true, ms, message: `连接正常（${ms}ms）` };
      const text = await res.text().catch(() => '');
      return { ok: false, ms, message: `HTTP ${res.status}：${text.slice(0, 160)}` };
    }

    // 先试 /models（便宜）；不支持就退化成一次 1 token 对话
    const modelsRes = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` }, signal: timeout(),
    }).catch(() => null);
    if (modelsRes?.ok) {
      const j: any = await modelsRes.json().catch(() => null);
      const count = Array.isArray(j?.data) ? j.data.length : undefined;
      const ms = Date.now() - started;
      return { ok: true, ms, message: `连接正常（${ms}ms${count ? ` · 列出 ${count} 个模型` : ''}）`, models: count };
    }
    const model = modelFallback ?? DEFAULT_MODELS.find((m) => m.provider === id)?.id ?? 'default';
    const chatRes = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: timeout(),
    });
    const ms = Date.now() - started;
    if (chatRes.ok) return { ok: true, ms, message: `连接正常（${ms}ms，用 ${model} 试跑）` };
    const text = await chatRes.text().catch(() => '');
    return { ok: false, ms, message: `HTTP ${chatRes.status}：${text.slice(0, 160)}` };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - started, message: `连接失败：${String(e?.message ?? e).slice(0, 160)}` };
  }
}

export interface TriBotApp {
  app: FastifyInstance;
  ctx: EngineContext;
  scheduler: RoutineScheduler;
}

/** 组装全部路由（不监听端口；Electron 内嵌 / 独立进程都可用） */
export async function buildTriBot(): Promise<TriBotApp> {
  const env = loadEnv();
  fs.mkdirSync(env.dataDir, { recursive: true });
  const db = openDb(env.dataDir);
  seedBots(db);

  // 老库里的设置可能缺新字段：读的时候统一补齐默认值，避免「没配过 sandbox」被当成全权
  const getSettings = (): AppSettings => {
    const cur = getSetting<Partial<AppSettings>>(db, 'settings', DEFAULT_SETTINGS);
    const skin = { ...DEFAULT_SETTINGS.skin, ...(cur.skin ?? {}) };
    const skinFile = safeSkinName(skin.file ?? '');
    // 默认无壁纸：开关开着但既没有预设、也没有对应文件，就当作没开
    const skinUsable = skin.enabled && (!!skin.preset || (!!skinFile && fs.existsSync(path.join(env.dataDir, 'skins', skinFile))));
    return {
      ...DEFAULT_SETTINGS,
      ...cur,
      routing: { ...DEFAULT_SETTINGS.routing, ...(cur.routing ?? {}) },
      thinking: { ...DEFAULT_SETTINGS.thinking, ...(cur.thinking ?? {}) },
      models: { ...DEFAULT_SETTINGS.models, ...(cur.models ?? {}) },
      planLimits: { ...DEFAULT_SETTINGS.planLimits, ...(cur.planLimits ?? {}) },
      search: { ...DEFAULT_SETTINGS.search, ...(cur.search ?? {}) },
      grants: cur.grants ?? [],
      sandbox: cur.sandbox ?? DEFAULT_SETTINGS.sandbox,
      approval: cur.approval ?? DEFAULT_SETTINGS.approval,
      commandWhitelist: cur.commandWhitelist ?? DEFAULT_SETTINGS.commandWhitelist,
      theme: cur.theme ?? DEFAULT_SETTINGS.theme,
      skin: skinUsable
        ? { ...skin, file: skinFile ?? undefined }
        : { ...skin, enabled: false, file: undefined },
      skillDirs: cur.skillDirs ?? [],
    };
  };
  const saveSettings = (s: AppSettings) => setSetting(db, 'settings', s);

  // 凭证：优先 data/credentials.json，其次 .env（baseKeys 是启动时的兜底）
  const envBaseKeys = { ...env.keys };
  const providerOverrides: Partial<Record<string, { baseURL?: string }>> = {};
  const registry = new ModelRegistry(env, {
    providerOverrides,
    customProviders: loadCustomProviders(env.dataDir),
  });
  registry.setCatalogModels(getSettings().models?.catalogs);
  const readCreds = () => loadCredentials(env.dataDir);
  const applyCreds = (creds: CredentialsFile) => {
    applyCredentials(env, creds, envBaseKeys);
    for (const pid of registry.allProviderIds()) {
      const b = creds.providers[pid]?.baseURL;
      if (b) providerOverrides[pid] = { baseURL: b };
      else delete providerOverrides[pid];
    }
  };
  const initialCreds = readCreds();
  applyCreds(initialCreds);
  // 有主密钥时，把历史明文凭证原地加密（一次性迁移）
  // 只在文件里还有明文时迁移；绝不因为解密失败而重写（那会把 Key 写没）
  try {
    if (credentialsNeedEncryption(env.dataDir)) saveCredentials(env.dataDir, initialCreds);
  } catch { /* 迁移失败不影响使用 */ }
  // 首次安装没有技能时，从打包内置的 seed-skills 复制一份基础技能
  try {
    const skillsDir = path.join(env.dataDir, 'skills');
    const seedDir = path.join(__dirname, '../seed-skills');
    if (fs.existsSync(seedDir) && (!fs.existsSync(skillsDir) || fs.readdirSync(skillsDir).length === 0)) {
      fs.cpSync(seedDir, skillsDir, { recursive: true });
    }
  } catch { /* 播种失败不影响启动 */ }
  try { scanSkills(db, env, getSettings()); } catch { /* 首扫失败不阻塞 */ }

  const ctx: EngineContext = { db, env, registry, getSettings, saveSettings };
  const contextDeps: ContextDeps = { db, env, registry, getSettings };

  const scheduler = new RoutineScheduler(ctx, {
    onRunEnd: (r, status, summary) => {
      try {
        db.prepare('INSERT INTO messages(id, session_id, role, content, created_at) VALUES(?,?,?,?,?)')
          .run(crypto.randomUUID(), r.sessionId, 'system',
            `⏰ Routine「${r.name}」执行${status === 'ok' ? '完成' : '失败'}：${summary.slice(0, 300)}`, nowIso());
      } catch { /* ignore */ }
    },
  });
  scheduler.start();

  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  // 每个会话正在跑的聊天；用于「停止」和防止同一会话并发
  const activeChats = new Map<string, AbortController>();
  await app.register(cors, { origin: true });

  const defaultBotId = () => listBots(db)[0]?.id;

  // 会话标题 sidecar：首轮后用一个便宜模型总结，不写回聊天记录
  const titleInFlight = new Set<string>();
  const pickTitleModel = () => {
    const ids = registry.allProviderIds().filter((p) => !!env.keys[p] && registry.modelsOfProvider(p).length > 0);
    const order = ['glm', 'minimax', 'deepseek', 'kimi', 'openai'];
    ids.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const id of ids) {
      const models = registry.modelsOfProvider(id);
      const m = models.find((x) => x.tier === 'fast') ?? models.find((x) => x.tier === 'balanced') ?? models[0];
      if (m) return m;
    }
    return null;
  };
  const generateSessionTitle = async (id: string): Promise<{ generated: boolean; title: string }> => {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return { generated: false, title: '' };
    let meta: { titleSource?: string; [k: string]: unknown } = {};
    try { meta = JSON.parse(row.meta || '{}'); } catch { /* ignore */ }
    if (meta.titleSource === 'custom' || meta.titleSource === 'generated') return { generated: false, title: row.title };
    const msgs = listMessages(db, id);
    const firstUser = msgs.find((m) => m.role === 'user');
    if (!firstUser) return { generated: false, title: row.title };
    const current = String(row.title || '');
    const defaultLike = !current || current === '新会话' || current === '新对话' || current === firstUser.content.slice(0, 18);
    if (!defaultLike) return { generated: false, title: row.title };
    if (titleInFlight.has(id)) return { generated: false, title: row.title };
    const model = pickTitleModel();
    if (!model) return { generated: false, title: row.title };
    titleInFlight.add(id);
    try {
      const context = msgs.slice(0, 6)
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 500)}`)
        .join('\n')
        .slice(0, 1800);
      const r = await chatStream({
        provider: model.provider,
        baseURL: registry.baseURL(model.provider),
        apiKey: registry.apiKey(env, model.provider)!,
        model: model.id,
        messages: [
          {
            role: 'system',
            content: '你是会话标题生成器。只输出一个 JSON 对象：{"title":"..."}。规则：用用户的主要语言；3-8 个词；概括用户要做的事/主题，不要回答问题；保留文件名、API、技术名词；不要引号、编号、结尾标点或任何解释。',
          },
          { role: 'user', content: `为下面这段对话起标题：\n\n${context}` },
        ],
        temperature: 0.2,
        maxTokens: 80,
        thinking: model.provider === 'glm' ? 'disabled' : undefined,
        timeoutMs: 25_000,
      });
      let title = String(r.content || '').trim();
      try {
        const parsed = JSON.parse(title);
        if (parsed?.title) title = String(parsed.title);
      } catch { /* 不是 JSON 就按纯文本处理 */ }
      title = title
        .replace(/^```(?:json)?/i, '').replace(/```$/, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .replace(/^#+\s*/, '')
        .replace(/\s+/g, ' ')
        .replace(/[。！？.!?]+$/, '')
        .trim()
        .slice(0, 40);
      if (!title) return { generated: false, title: row.title };
      const nextMeta = { ...meta, titleSource: 'generated' };
      db.prepare('UPDATE sessions SET title = ?, updated_at = ?, meta = ? WHERE id = ?')
        .run(title, nowIso(), JSON.stringify(nextMeta), id);
      return { generated: true, title };
    } catch {
      return { generated: false, title: row.title };
    } finally {
      titleInFlight.delete(id);
    }
  };

  // ---------- 基础 ----------
  // 生产模式：直接托管打包好的前端（原生壳/浏览器都能用 http://127.0.0.1:<port>/ 打开）
  const rendererRoot = path.join(__dirname, 'renderer');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
  };
  app.get('/', async (_req, reply) => {
    const file = path.join(rendererRoot, 'index.html');
    if (!fs.existsSync(file)) return reply.code(404).send({ error: '还没有构建前端：先 pnpm package' });
    return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(fs.readFileSync(file));
  });
  app.get('/assets/*', async (req, reply) => {
    const rel = String((req.params as Record<string, string>)['*'] ?? '');
    const abs = path.resolve(rendererRoot, 'assets', rel);
    if (!abs.startsWith(path.resolve(rendererRoot, 'assets') + path.sep) || !fs.existsSync(abs)) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.header('Cache-Control', 'no-store').type(MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream').send(fs.readFileSync(abs));
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: VERSION,
    port: (globalThis as any).__tribotPort ?? env.port,
    keys: Object.fromEntries(registry.allProviderIds().map((id) => [id, !!env.keys[id]])),
    dataDir: env.dataDir,
  }));

  app.get('/api/providers', async () => ({
    providers: registry.providerInfos(env),
    models: registry.allModels(),
    deepseekPeriod: deepseekPeriod(),
    customProviders: registry.customProviders(),
  }));

  // ---------- 凭证（设置页：按供应商填 Key / Base URL，存 data/credentials.json）----------
  const credentialPayload = () => {
    const creds = readCreds();
    const views: CredentialView[] = registry.allProviderIds().map((pid) => {
      const def = registry.providerDef(pid)!;
      return credentialView({
        id: pid,
        label: def.label,
        billing: def.billing,
        defaultBaseURL: def.baseURL,
        cred: creds.providers[pid],
        envKey: envBaseKeys[pid],
        models: registry.modelsOfProvider(pid).length,
      });
    });
    views.push(credentialView({
      id: 'tavily',
      label: 'Tavily',
      billing: 'tool',
      defaultBaseURL: 'https://api.tavily.com',
      cred: creds.tools?.tavily,
      envKey: envBaseKeys.tavily,
      models: 0,
    }));
    return {
      credentials: views,
      file: credentialsPath(env.dataDir),
      envFile: path.join(env.root, '.env'),
      customProviders: registry.customProviders(),
    };
  };

  app.get('/api/credentials', async () => credentialPayload());

  app.put('/api/credentials/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id !== 'tavily' && !registry.providerDef(id)) {
      return reply.code(400).send({ error: '未知供应商' });
    }
    const body = (req.body ?? {}) as { apiKey?: string | null; baseURL?: string | null };
    try {
      const next = setCredential(readCreds(), id as CredentialId, {
        apiKey: body.apiKey === undefined ? undefined : (body.apiKey ?? ''),
        baseURL: body.baseURL === undefined ? undefined : (body.baseURL ?? ''),
      });
      saveCredentials(env.dataDir, next);
      applyCreds(next);
      return { ok: true, ...credentialPayload() };
    } catch (e: any) {
      return reply.code(500).send({ error: `保存凭证失败：${String(e?.message ?? e)}` });
    }
  });

  app.post('/api/credentials/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id !== 'tavily' && !registry.providerDef(id)) {
      return reply.code(400).send({ error: '未知供应商' });
    }
    const body = (req.body ?? {}) as { apiKey?: string; baseURL?: string };
    const def = registry.providerDef(id);
    const result = await testCredential(
      id as CredentialId,
      body.apiKey,
      body.baseURL,
      def?.baseURL,
      registry.modelsOfProvider(id)[0]?.id,
    );
    return result;
  });

  app.get('/api/provider-presets', async () => ({ presets: PROVIDER_PRESETS }));

  // ---------- 自定义供应商（Kimi / OpenAI / 本地…）----------
  app.post('/api/providers', async (req, reply) => {
    const body = (req.body ?? {}) as any;
    try {
      const rawModels = Array.isArray(body.models)
        ? body.models
        : String(body.models ?? '').split(/[\n,]/);
      const models = rawModels
        .map((m: any) => (typeof m === 'string' ? { id: m.trim() } : m))
        .filter((m: any) => m && String(m.id ?? '').trim());
      const provider = normalizeProvider({
        id: body.id,
        label: body.label,
        baseURL: body.baseURL,
        billing: body.billing,
        models,
      });
      const next = upsertCustomProvider(loadCustomProviders(env.dataDir), provider);
      saveCustomProviders(env.dataDir, next);
      registry.setCustomProviders(next);
      if (body.apiKey !== undefined) {
        const creds = setCredential(readCreds(), provider.id as CredentialId, { apiKey: String(body.apiKey ?? '') });
        saveCredentials(env.dataDir, creds);
        applyCreds(creds);
      } else {
        applyCreds(readCreds());
      }
      return {
        ok: true,
        provider,
        providers: registry.providerInfos(env),
        models: registry.allModels(),
        customProviders: next,
      };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.delete('/api/providers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!registry.isCustom(id)) return reply.code(400).send({ error: '只能删除自定义供应商' });
    const next = removeCustomProvider(loadCustomProviders(env.dataDir), id);
    saveCustomProviders(env.dataDir, next);
    registry.setCustomProviders(next);
    const creds = setCredential(readCreds(), id as CredentialId, { apiKey: '' });
    saveCredentials(env.dataDir, creds);
    applyCreds(creds);
    return { ok: true, providers: registry.providerInfos(env), models: registry.allModels(), customProviders: next };
  });

  /** 拉取这家供应商的模型清单（OpenAI 兼容 /models；新供应商还没入库时也可以先拉） */
  app.post('/api/providers/:id/models', async (req, reply) => {
    const { id } = req.params as { id: string };
    const def = registry.providerDef(id);
    const body = (req.body ?? {}) as { baseURL?: string; apiKey?: string };
    const saved = readCreds().providers[id]?.baseURL;
    const base = String(body.baseURL || saved || def?.baseURL || '').replace(/\/+$/, '');
    if (!base) return reply.code(400).send({ error: '先填 Base URL' });
    const key = body.apiKey?.trim() || env.keys[id] || readCreds().providers[id]?.apiKey;
    if (!key) return reply.code(400).send({ error: '还没有填 Key' });
    try {
      const r = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return reply.code(502).send({ error: `HTTP ${r.status}：${t.slice(0, 200)}` });
      }
      const j: any = await r.json().catch(() => null);
      const ids = Array.isArray(j?.data) ? j.data.map((x: any) => x?.id).filter(Boolean) : [];
      return { ok: true, models: ids.slice(0, 100) };
    } catch (e: any) {
      return reply.code(502).send({ error: `拉取失败：${String(e?.message ?? e).slice(0, 160)}` });
    }
  });

  // ---------- 会话 ----------
  app.get('/api/sessions', async () => {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 200').all() as any[];
    return { sessions: rows.map(rowToSession) };
  });

  app.post('/api/sessions', async (req) => {
    const body = (req.body ?? {}) as { title?: string; type?: 'chat' | 'task'; workspace?: string };
    const session = createSession(db, body.title?.slice(0, 60) || '新会话', body.type ?? 'chat');
    // 每个任务默认有自己的文件夹：data/tasks/<短 id>，也可以直接指定已有目录
    const workspace = body.workspace && body.workspace.trim()
      ? path.resolve(body.workspace.trim())
      : defaultTaskWorkspace(env.dataDir, session.id);
    fs.mkdirSync(workspace, { recursive: true });
    touchSession(db, session.id, { workspace, workspaces: [workspace] });
    return { session: rowToSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id) as any) };
  });

  app.get('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'session 不存在' });
    }
    return { messages: listMessages(db, id) };
  });

  app.get('/api/sessions/:id/checkpoints', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'session 不存在' });
    }
    return { checkpoints: listCheckpoints(db, id) };
  });

  // 侧栏文件树 / 文件预览（只读，锁在会话工作区内）
  const workspaceRootsOf = (row: any): string[] => {
    let meta: any = {};
    try { meta = JSON.parse(row?.meta || '{}'); } catch { /* ignore */ }
    const raw: string[] = Array.isArray(meta.workspaces) && meta.workspaces.length
      ? meta.workspaces
      : meta.workspace ? [meta.workspace] : [];
    return [...new Set(raw.map((p) => path.resolve(String(p))))].filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  };
  const withinRoots = (roots: string[], target: string): boolean => {
    const t = path.resolve(target);
    return roots.some((r) => t === r || t.startsWith(r + path.sep));
  };

  app.get('/api/sessions/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'session 不存在' });
    const roots = workspaceRootsOf(row);
    if (roots.length === 0) return { roots: [], dir: '', entries: [] };
    const q = (req.query ?? {}) as { dir?: string };
    const dir = path.resolve(String(q.dir || roots[0]));
    if (!withinRoots(roots, dir)) return reply.code(403).send({ error: '目录不在工作区内' });
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { roots, dir, entries: [] }; }
    const list = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => {
        const full = path.join(dir, e.name);
        let size = 0;
        try { size = e.isFile() ? fs.statSync(full).size : 0; } catch { /* ignore */ }
        return { name: e.name, path: full, dir: e.isDirectory(), size };
      })
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      .slice(0, 500);
    return { roots, dir, entries: list };
  });

  app.get('/api/sessions/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'session 不存在' });
    const roots = workspaceRootsOf(row);
    const q = (req.query ?? {}) as { path?: string };
    const target = path.resolve(String(q.path || ''));
    if (!q.path || !withinRoots(roots, target)) return reply.code(403).send({ error: '文件不在工作区内' });
    const st = fs.existsSync(target) ? fs.statSync(target) : null;
    if (!st || !st.isFile()) return reply.code(404).send({ error: '文件不存在' });
    const ext = path.extname(target).toLowerCase();
    if (ext === '.pdf') {
      return { path: target, name: path.basename(target), ext, size: st.size, kind: 'pdf' };
    }
    if (st.size > 2_000_000) return reply.code(413).send({ error: '文件超过 2MB，暂不预览' });
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
    if (imageExts.has(ext)) {
      const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1).replace('jpg', 'jpeg')}`;
      return { path: target, name: path.basename(target), ext, size: st.size, kind: 'image', dataUrl: `data:${mime};base64,${fs.readFileSync(target).toString('base64')}` };
    }
    const buf = fs.readFileSync(target);
    if (buf.includes(0)) return { path: target, name: path.basename(target), ext, size: st.size, kind: 'binary' };
    return { path: target, name: path.basename(target), ext, size: st.size, kind: 'text', text: buf.toString('utf8') };
  });

  // PDF / 图片原文件：给 <iframe> 内联预览用（不走 base64，避免大文件卡顿）
  app.get('/api/sessions/:id/raw', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'session 不存在' });
    const roots = workspaceRootsOf(row);
    const q = (req.query ?? {}) as { path?: string };
    const target = path.resolve(String(q.path || ''));
    if (!q.path || !withinRoots(roots, target)) return reply.code(403).send({ error: '文件不在工作区内' });
    const st = fs.existsSync(target) ? fs.statSync(target) : null;
    if (!st || !st.isFile()) return reply.code(404).send({ error: '文件不存在' });
    if (st.size > 30_000_000) return reply.code(413).send({ error: '文件超过 30MB' });
    const ext = path.extname(target).toLowerCase();
    const mime: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    };
    return reply
      .header('Content-Type', mime[ext] ?? 'application/octet-stream')
      .header('Content-Disposition', 'inline')
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(target));
  });

  app.post('/api/checkpoints/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = restoreCheckpoint(db, id);
    if (!result.ok) return reply.code(400).send({ error: result.message });
    return result;
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { title?: string; workspace?: string; workspaces?: string[] };
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'session 不存在' });
    if (body.title) {
      db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(body.title.slice(0, 60), nowIso(), id);
      touchSession(db, id, { titleSource: 'custom' });
    }
    if (body.workspaces !== undefined) {
      // 一个任务多个文件夹：第一个是主目录
      const raw = Array.isArray(body.workspaces) ? body.workspaces : [];
      const list: string[] = [];
      const seen = new Set<string>();
      for (const item of raw) {
        const t = String(item ?? '').trim();
        if (!t) continue;
        const abs = path.resolve(t);
        try {
          fs.mkdirSync(abs, { recursive: true });
          if (!fs.statSync(abs).isDirectory()) throw new Error('不是目录');
        } catch (e: any) {
          return reply.code(400).send({ error: `目录不可用：${String(e?.message ?? e)}` });
        }
        const key = abs.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(abs);
      }
      if (list.length === 0) touchSession(db, id, { workspace: undefined as any, workspaces: undefined as any });
      else touchSession(db, id, { workspace: list[0], workspaces: list });
    } else if (body.workspace !== undefined) {
      const raw = String(body.workspace ?? '').trim();
      if (raw) {
        const abs = path.resolve(raw);
        try {
          fs.mkdirSync(abs, { recursive: true });
          if (!fs.statSync(abs).isDirectory()) throw new Error('不是目录');
        } catch (e: any) {
          return reply.code(400).send({ error: `目录不可用：${String(e?.message ?? e)}` });
        }
        touchSession(db, id, { workspace: abs, workspaces: [abs] });
      } else {
        // 清空 = 退回 Bot 默认工作区
        touchSession(db, id, { workspace: undefined as any, workspaces: undefined as any });
      }
    }
    return { ok: true, session: rowToSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any) };
  });

  app.post('/api/sessions/:id/title', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'session 不存在' });
    }
    return generateSessionTitle(id);
  });

  app.delete('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT meta FROM sessions WHERE id = ?').get(id) as { meta?: string } | undefined;
    let workspace: string | undefined;
    try { workspace = JSON.parse(row?.meta || '{}').workspace; } catch { /* ignore */ }

    const messages = db.prepare('DELETE FROM messages WHERE session_id = ?').run(id).changes;
    const outputs = db.prepare('DELETE FROM tool_outputs WHERE session_id = ?').run(id).changes;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    db.prepare('UPDATE routines SET enabled = 0 WHERE session_id = ?').run(id);
    const next = dropSessionGrants(getSettings(), id);
    if (next !== getSettings()) saveSettings(next);

    // 只删我们自己管的目录（data/tasks 下）；用户指向的项目目录绝不碰
    let removedDir: string | null = null;
    if (workspace) {
      const tasksRoot = path.resolve(path.join(env.dataDir, 'tasks'));
      const abs = path.resolve(workspace);
      const rel = path.relative(tasksRoot, abs);
      const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      if (inside && fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        removedDir = abs;
      }
    }
    return { ok: true, removed: { messages, outputs, dir: removedDir, keptWorkspace: !!workspace && !removedDir } };
  });

  // ---------- 聊天（SSE）----------
  app.post<{ Body: ChatRequest }>('/api/chat', async (req, reply) => {
    const body = req.body;
    if (!body?.sessionId || !body?.content?.trim()) {
      return reply.code(400).send({ error: 'sessionId 和 content 必填' });
    }
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(body.sessionId)) {
      return reply.code(404).send({ error: 'session 不存在' });
    }
    const titleRow = db.prepare('SELECT title FROM sessions WHERE id = ?').get(body.sessionId) as any;
    if (titleRow?.title === '新会话') {
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(body.content.slice(0, 18), body.sessionId);
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // reply.hijack 会绕过 CORS 插件，这里手动回写，否则浏览器直连会 Failed to fetch
      ...(req.headers.origin ? { 'Access-Control-Allow-Origin': req.headers.origin, Vary: 'Origin' } : {}),
    });
    const send = (e: StreamEvent) => {
      try { raw.write(`data: ${JSON.stringify(e)}\n\n`); } catch { /* 已断开 */ }
    };
    const heartbeat = setInterval(() => {
      try { raw.write(': ping\n\n'); } catch { /* ignore */ }
    }, 15_000);
    const controller = new AbortController();
    activeChats.set(body.sessionId, controller);
    raw.on('close', () => { controller.abort(); clearInterval(heartbeat); });

    try {
      await runChat(ctx, {
        sessionId: body.sessionId,
        botId: body.botId ?? defaultBotId()!,
        userText: body.content,
        taskCard: body.taskCard,
        mode: body.mode,
        manualModel: body.model,
        compareModels: body.compareModels,
        thinking: body.thinking,
        plan: body.plan,
        emit: send,
        signal: controller.signal,
      });
    } catch (e: any) {
      if (controller.signal.aborted) send({ type: 'done' });
      else send({ type: 'error', message: String(e?.message ?? e) });
    } finally {
      if (activeChats.get(body.sessionId) === controller) activeChats.delete(body.sessionId);
      clearInterval(heartbeat);
      try { raw.end(); } catch { /* ignore */ }
    }
  });

  // 停止当前会话正在生成的回复
  app.post('/api/sessions/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const controller = activeChats.get(id);
    if (!controller) return { ok: false, note: '当前没有正在生成的回复' };
    controller.abort();
    return { ok: true };
  });

  // ---------- Bot ----------
  app.get('/api/bots', async () => ({ bots: listBots(db) }));

  app.post('/api/bots', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b?.name || !b?.systemPrompt) return reply.code(400).send({ error: 'name 和 systemPrompt 必填' });
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO bots(id, name, emoji, role, system_prompt, tools, model_pref, thinking, builtin, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(id, String(b.name).slice(0, 30), b.emoji ?? '🤖', String(b.role ?? '').slice(0, 120),
      b.systemPrompt, JSON.stringify(Array.isArray(b.tools) ? b.tools : ['*']), b.modelPref ?? null,
      b.thinking ?? null, 0, nowIso());
    return { bot: getBot(db, id) };
  });

  app.patch('/api/bots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = getBot(db, id);
    if (!cur) return reply.code(404).send({ error: '不存在' });
    const b = (req.body ?? {}) as any;
    db.prepare('UPDATE bots SET name=?, emoji=?, role=?, system_prompt=?, tools=?, model_pref=?, thinking=? WHERE id=?').run(
      b.name ?? cur.name, b.emoji ?? cur.emoji, b.role ?? cur.role, b.systemPrompt ?? cur.systemPrompt,
      JSON.stringify(Array.isArray(b.tools) ? b.tools : cur.tools),
      b.modelPref === undefined ? (cur.modelPref ?? null) : (b.modelPref || null),
      b.thinking === undefined ? (cur.thinking ?? null) : (b.thinking || null), id,
    );
    return { bot: getBot(db, id) };
  });

  app.delete('/api/bots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const bot = getBot(db, id);
    if (!bot) return reply.code(404).send({ error: '不存在' });
    if (bot.builtin) return reply.code(400).send({ error: '内置 Bot 不可删除（可以编辑）' });
    db.prepare('DELETE FROM bots WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---------- 审批 ----------
  app.get('/api/approvals', async () => {
    const rows = db.prepare(
      "SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50",
    ).all() as any[];
    return {
      approvals: rows.map((r) => ({
        id: r.id, sessionId: r.session_id, botName: r.bot_name, tool: r.tool,
        args: JSON.parse(r.args), risk: r.risk, reason: r.reason, status: r.status, createdAt: r.created_at,
      })),
    };
  });

  app.post('/api/approvals/:id/decide', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { decision, scope } = (req.body ?? {}) as { decision?: string; scope?: 'once' | 'session' | 'always' };
    if (decision !== 'approved' && decision !== 'denied') {
      return reply.code(400).send({ error: 'decision 必须是 approved / denied' });
    }
    const effScope = decision === 'approved' && (scope === 'session' || scope === 'always') ? scope : 'once';
    const ok = resolveApproval(id, decision, effScope);
    return { ok, scope: effScope, note: ok ? '' : '没有等待中的审批（可能已超时）' };
  });

  // ---------- 授权（工具权限）----------
  app.get('/api/grants', async () => {
    const settings = getSettings();
    return { grants: settings.grants ?? [], sandbox: settings.sandbox, approval: settings.approval };
  });

  app.post('/api/grants', async (req, reply) => {
    const { tool, scope, sessionId } = (req.body ?? {}) as {
      tool?: string; scope?: 'session' | 'always'; sessionId?: string;
    };
    if (!tool) return reply.code(400).send({ error: 'tool 必填' });
    if (scope !== 'session' && scope !== 'always') return reply.code(400).send({ error: 'scope 必须是 session / always' });
    if (scope === 'session' && !sessionId) return reply.code(400).send({ error: '会话级授权需要 sessionId' });
    const next = withGrant(getSettings(), { tool, scope, sessionId });
    saveSettings(next);
    return { grants: next.grants, sandbox: next.sandbox, approval: next.approval };
  });

  app.delete('/api/grants/:id', async (req) => {
    const { id } = req.params as { id: string };
    const next = withoutGrant(getSettings(), id);
    saveSettings(next);
    return { grants: next.grants };
  });

  // ---------- 上下文洞察 ----------
  app.get('/api/sessions/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return reply.code(404).send({ error: 'session 不存在' });
    const session = rowToSession(row);
    const msgs = listMessages(db, id);
    const statRows = db.prepare(
      "SELECT input_tokens, output_tokens, cached_tokens, latency_ms FROM messages WHERE session_id = ? AND role = 'assistant'",
    ).all(id) as Array<{ input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null; latency_ms: number | null }>;
    const usage = summarizeSessionUsage(statRows.map((r) => ({
      inputTokens: r.input_tokens, outputTokens: r.output_tokens,
      cachedTokens: r.cached_tokens, latencyMs: r.latency_ms,
    })));
    let saved = 0;
    try { saved = buildContextInsight(contextDeps, { sessionId: id }).savings.totalTokens; } catch { /* ignore */ }

    const lines: string[] = [
      `# ${session.title}`,
      '',
      `- 类型：${session.type === 'task' ? '任务' : '对话'}`,
      `- 创建：${new Date(session.createdAt).toLocaleString('zh-CN')}`,
      `- 更新：${new Date(session.updatedAt).toLocaleString('zh-CN')}`,
      `- 用量：输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens，缓存命中 ${Math.round(usage.cacheHitRate * 100)}%，约 ${usage.tokensPerSec.toFixed(1)} tok/s`,
      `- 节省：${saved} tokens（工具输出压缩 + 摘要）`,
    ];
    if (session.meta?.workspaces?.length) lines.push(`- 任务目录：${session.meta.workspaces.join('；')}`);
    lines.push('', '---', '');
    for (const m of msgs) {
      if (m.role === 'system') {
        lines.push(`> ${m.content.replace(/\n/g, '\n> ')}`, '');
        continue;
      }
      if (m.role === 'user') {
        lines.push('### 用户', '', m.content, '');
        continue;
      }
      const meta = [m.botName, m.model, m.usage ? `${m.usage.inputTokens}→${m.usage.outputTokens} tok` : '']
        .filter(Boolean).join(' · ');
      lines.push(`### ${m.role === 'assistant' ? (m.botName ?? '助手') : '系统'}${meta ? `（${meta}）` : ''}`, '', m.content, '');
    }
    const md = lines.join('\n');
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="tribot-${id.slice(0, 8)}.md"`);
    return md;
  });

  // 按模型聚合的 token 用量（设置 → 用量统计）
  app.get('/api/stats/usage', async () => {
    const rows = db.prepare(`
      SELECT COALESCE(model, '未知') AS model, COALESCE(provider, '') AS provider,
             COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
             COUNT(*) AS calls
      FROM messages WHERE role = 'assistant'
      GROUP BY model, provider
      ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC
    `).all() as Array<{ model: string; provider: string; input: number; output: number; calls: number }>;
    const models = rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      inputTokens: r.input,
      outputTokens: r.output,
      totalTokens: r.input + r.output,
      calls: r.calls,
    }));
    return {
      totalTokens: models.reduce((n, m) => n + m.totalTokens, 0),
      totalInput: models.reduce((n, m) => n + m.inputTokens, 0),
      totalOutput: models.reduce((n, m) => n + m.outputTokens, 0),
      models,
    };
  });

  // 全局累计 token（所有会话的 assistant 消息）
  app.get('/api/stats/total', async () => {
    const row = db.prepare(
      "SELECT COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COUNT(*) AS messages FROM messages WHERE role = 'assistant'",
    ).get() as { input: number; output: number; messages: number };
    return {
      inputTokens: row.input,
      outputTokens: row.output,
      totalTokens: row.input + row.output,
      messages: row.messages,
    };
  });

  app.get('/api/sessions/:id/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'session 不存在' });
    }
    const rows = db.prepare(
      "SELECT input_tokens, output_tokens, cached_tokens, latency_ms FROM messages WHERE session_id = ? AND role = 'assistant'",
    ).all(id) as Array<{ input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null; latency_ms: number | null }>;
    const usage = summarizeSessionUsage(rows.map((r) => ({
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedTokens: r.cached_tokens,
      latencyMs: r.latency_ms,
    })));
    let context: { used: number; budget: number; savedTokens: number; savedYuan: number } | null = null;
    try {
      const insight = buildContextInsight(contextDeps, { sessionId: id });
      context = {
        used: insight.used,
        budget: insight.budget,
        savedTokens: insight.savings.totalTokens,
        savedYuan: insight.savings.costSavedYuan,
      };
    } catch { /* 没有消息时也要能返回用量 */ }
    return {
      stats: {
        ...usage,
        contextUsed: context?.used ?? 0,
        contextBudget: context?.budget ?? 0,
        contextPct: context && context.budget > 0 ? context.used / context.budget : 0,
        savedTokens: context?.savedTokens ?? 0,
        savedYuan: context?.savedYuan ?? 0,
      },
    };
  });

  app.get('/api/context', async (req, reply) => {
    const { sessionId, botId, model } = req.query as { sessionId?: string; botId?: string; model?: string };
    if (!sessionId) return reply.code(400).send({ error: 'sessionId 必填' });
    try {
      return { insight: buildContextInsight(contextDeps, { sessionId, botId, model }) };
    } catch (e: any) {
      return reply.code(404).send({ error: String(e?.message ?? e) });
    }
  });

  app.post('/api/context/compact', async (req, reply) => {
    const { sessionId } = (req.body ?? {}) as { sessionId?: string };
    if (!sessionId) return reply.code(400).send({ error: 'sessionId 必填' });
    const result = await compactSession(contextDeps, sessionId);
    return { ...result, insight: buildContextInsight(contextDeps, { sessionId }) };
  });

  // ---------- 插件市场 ----------
  // 预设源：都是公开仓库，扫描时会实时拉 SKILL.md
  const GITHUB_PRESETS = [
    { id: 'anthropic-skills', label: 'Anthropic Skills', url: 'https://github.com/anthropics/skills' },
    { id: 'hallmark', label: 'Hallmark 设计技能', url: 'https://github.com/Nutlope/hallmark' },
    { id: 'ui-ux-pro-max', label: 'UI/UX Pro Max', url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max' },
  ];

  app.get('/api/market/sources', async () => ({ sources: GITHUB_PRESETS }));

  app.post('/api/market/github/scan', async (req, reply) => {
    const { url } = (req.body ?? {}) as { url?: string };
    try {
      const installed = new Set(
        (db.prepare('SELECT id FROM skills').all() as Array<{ id: string }>).map((r) => r.id),
      );
      const result = await scanGitHubSkills(String(url ?? ''), installed);
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.post('/api/market/github/install', async (req, reply) => {
    const { url, path: skillPath } = (req.body ?? {}) as { url?: string; path?: string };
    if (!url || !skillPath) return reply.code(400).send({ error: '缺少仓库地址或技能路径' });
    try {
      const r = await installGitHubSkill(String(url), String(skillPath), env.dataDir);
      scanSkills(db, env, getSettings());
      return { ok: true, ...r };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.get('/api/plugins', async () => ({
    ...listPlugins(db, env),
    sandbox: getSettings().sandbox,
  }));

  app.post('/api/plugins/:id/install', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const plugin = installPlugin(db, env, getSettings(), id);
      return { ok: true, plugin };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.post('/api/plugins/:id/uninstall', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = uninstallPlugin(db, env, getSettings(), id);
      return { ok };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.post('/api/plugins/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { enabled } = (req.body ?? {}) as { enabled?: boolean };
    try {
      const plugin = togglePlugin(db, env, getSettings(), id, enabled !== false);
      return { ok: true, plugin };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  // ---------- 配额 ----------
  app.get('/api/quota', async () => ({ providers: await quotaDashboardCached(db, env, getSettings()) }));

  // ---------- 技能 ----------
  app.get('/api/skills', async () => {
    const rows = db.prepare('SELECT * FROM skills ORDER BY name').all() as any[];
    return { skills: rows.map(rowToSkill), dirs: { defaults: true } };
  });

  app.post('/api/skills/scan', async () => {
    const skills = scanSkills(db, env, getSettings());
    return { skills, count: skills.length };
  });

  app.patch('/api/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { enabled } = (req.body ?? {}) as { enabled?: boolean };
    db.prepare('UPDATE skills SET enabled = ? WHERE id = ?').run(enabled === false ? 0 : 1, id);
    return { ok: true };
  });

  app.delete('/api/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---------- Routine ----------
  app.get('/api/routines', async () => {
    const rows = db.prepare('SELECT * FROM routines ORDER BY name').all() as any[];
    const routines = rows.map(rowToRoutine);
    const runs = db.prepare('SELECT * FROM routine_runs ORDER BY ts DESC LIMIT 100').all() as any[];
    return {
      routines,
      runs: runs.map((r) => ({ id: r.id, routineId: r.routine_id, ts: r.ts, status: r.status, summary: r.summary })),
      bots: listBots(db).map((b) => ({ id: b.id, name: b.name, emoji: b.emoji })),
    };
  });

  app.post('/api/routines', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b?.name || !b?.schedule || !b?.botId || !b?.prompt) {
      return reply.code(400).send({ error: 'name/schedule/botId/prompt 必填' });
    }
    if (!validateCron(String(b.schedule))) {
      return reply.code(400).send({ error: 'cron 表达式无效（五段式，如 "0 9 * * 1-5"）' });
    }
    if (!getBot(db, String(b.botId))) return reply.code(400).send({ error: 'botId 不存在' });
    return { routine: createRoutineWithSession(db, {
      name: String(b.name).slice(0, 60), schedule: String(b.schedule), botId: String(b.botId), prompt: String(b.prompt),
      offpeakOnly: !!b.offpeakOnly,
    }) };
  });

  app.patch('/api/routines/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as any;
    const cur = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as any;
    if (!cur) return { error: '不存在' };
    if (b.schedule && !validateCron(String(b.schedule))) return { error: 'cron 表达式无效' };
    db.prepare('UPDATE routines SET name=?, schedule=?, bot_id=?, prompt=?, enabled=?, offpeak_only=? WHERE id=?').run(
      b.name ?? cur.name, b.schedule ?? cur.schedule, b.botId ?? cur.bot_id,
      b.prompt ?? cur.prompt, b.enabled === undefined ? cur.enabled : (b.enabled ? 1 : 0),
      b.offpeakOnly === undefined ? cur.offpeak_only : (b.offpeakOnly ? 1 : 0), id,
    );
    return { routine: rowToRoutine(db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as any) };
  });

  app.delete('/api/routines/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT session_id FROM routines WHERE id = ?').get(id) as any;
    db.prepare('DELETE FROM routines WHERE id = ?').run(id);
    db.prepare('DELETE FROM routine_runs WHERE routine_id = ?').run(id);
    if (row) {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(row.session_id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    }
    return { ok: true };
  });

  app.post('/api/routines/:id/run', async (req) => {
    const { id } = req.params as { id: string };
    const result = await scheduler.runOnce(id);
    return result;
  });

  // ---------- 设置 ----------
  app.get('/api/settings', async () => ({ settings: getSettings() }));

  app.put('/api/settings', async (req) => {
    const incoming = (req.body ?? {}) as Partial<AppSettings>;
    const cur = getSettings();
    const merged: AppSettings = {
      routing: { ...cur.routing, ...incoming.routing },
      approval: incoming.approval ?? cur.approval,
      sandbox: incoming.sandbox ?? cur.sandbox,
      grants: incoming.grants ?? cur.grants,
      thinking: { ...cur.thinking, ...incoming.thinking },
      models: { ...cur.models, ...(incoming.models ?? {}) },
      commandWhitelist: incoming.commandWhitelist ?? cur.commandWhitelist,
      theme: incoming.theme ?? cur.theme,
      skin: { ...cur.skin, ...(incoming.skin ?? {}) },
      planLimits: { ...cur.planLimits, ...incoming.planLimits },
      skillDirs: incoming.skillDirs ?? cur.skillDirs,
      search: { ...cur.search, ...incoming.search },
    };
    setSetting(db, 'settings', merged);
    registry.setCatalogModels(merged.models?.catalogs);
    return { settings: merged };
  });

  // ---------- 自定义皮肤（上传图片当背景）----------
  const skinsDir = () => path.join(env.dataDir, 'skins');

  app.post('/api/skin', async (req, reply) => {
    const { dataUrl } = (req.body ?? {}) as { dataUrl?: string };
    try {
      const { ext, buffer } = parseSkinDataUrl(String(dataUrl ?? ''));
      const dir = skinsDir();
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) {
        if (/^current\./i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
      const file = `current.${ext}`;
      fs.writeFileSync(path.join(dir, file), buffer);
      const cur = getSettings();
      const next: AppSettings = { ...cur, skin: { ...cur.skin, enabled: true, file, preset: undefined } };
      setSetting(db, 'settings', next);
      return { ok: true, settings: next, file };
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message ?? e) });
    }
  });

  app.get('/api/skin/image', async (_req, reply) => {
    const file = safeSkinName(getSettings().skin?.file ?? '');
    if (!file) return reply.code(404).send({ error: '还没有皮肤' });
    const abs = path.join(skinsDir(), file);
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: '皮肤文件不存在' });
    reply.header('Cache-Control', 'no-store');
    reply.type(skinContentType(file));
    return reply.send(fs.createReadStream(abs));
  });

  app.delete('/api/skin', async () => {
    const cur = getSettings();
    const file = safeSkinName(cur.skin?.file ?? '');
    if (file) {
      try { fs.rmSync(path.join(skinsDir(), file), { force: true }); } catch { /* ignore */ }
    }
    const next: AppSettings = { ...cur, skin: { ...cur.skin, enabled: false, file: undefined, preset: undefined } };
    setSetting(db, 'settings', next);
    return { ok: true, settings: next };
  });

  return { app, ctx, scheduler };
}

/** 独立进程启动：监听 127.0.0.1，写 daemon.json 供 CLI/App 发现 */
export async function startServer(preferredPort?: number): Promise<{ app: FastifyInstance; port: number }> {
  const env = loadEnv();
  const { app, scheduler } = await buildTriBot();

  let port = preferredPort ?? env.port;
  for (let i = 0; i < 11; i++) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      break;
    } catch (e: any) {
      if (e?.code === 'EADDRINUSE' && i < 10) port++;
      else throw e;
    }
  }
  (globalThis as any).__tribotPort = port;

  const daemonFile = path.join(env.dataDir, 'daemon.json');
  fs.writeFileSync(daemonFile, JSON.stringify({ port, pid: process.pid, startedAt: nowIso() }, null, 2));

  const shutdown = () => {
    try { fs.rmSync(daemonFile, { force: true }); } catch { /* ignore */ }
    scheduler.stop();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => { try { fs.rmSync(daemonFile, { force: true }); } catch { /* ignore */ } });

  console.log(`[TriBot] server 已启动 http://127.0.0.1:${port}（数据目录 ${env.dataDir}）`);
  return { app, port };
}

// 注意：不要在本模块自动启动（打包入口 electron/server-entry.ts 负责），
// 避免同进程重复监听两个端口。

