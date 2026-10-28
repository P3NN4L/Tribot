import type {
  AppSettings, Approval, ApprovalScope, Bot, ChatMessage, ChatRequest, CheckpointInfo, ContextInsight, HealthInfo, ModelInfo,
  PluginCatalog, PluginInfo, ProviderInfo, QuotaSnapshot, Routine, RoutineRun, Session, SkillMeta, StreamEvent,
  TaskCard, ThinkingEffort, ToolGrant,
} from '@tribot/shared';

// ===== 本地 server 的 HTTP/SSE 客户端（Electron 渲染层 & 浏览器调试共用）=====

function initialPort(): string {
  const q = new URLSearchParams(location.search).get('port');
  if (q) {
    localStorage.setItem('tribot_port', q);
    return q;
  }
  return localStorage.getItem('tribot_port') || '47615';
}

let port = initialPort();
export const getPort = () => port;
export function setPort(p: string): void {
  port = p;
  localStorage.setItem('tribot_port', p);
}
export const baseUrl = (): string => `http://127.0.0.1:${port}`;
/** 皮肤图片地址（带版本号避免缓存） */
export const skinUrl = (v?: string): string => `${baseUrl()}/api/skin/image${v ? `?v=${encodeURIComponent(v)}` : ''}`;

export interface ProviderPreset {
  id: string;
  label: string;
  baseURL: string;
  billing: 'subscription' | 'payg';
  kind: 'model' | 'tool';
  builtin?: boolean;
  models: Array<{ id: string; label?: string; tier?: 'flagship' | 'balanced' | 'fast' }>;
  note?: string;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
  tokensPerSec: number;
  totalLatencyMs: number;
  messages: number;
  contextUsed: number;
  contextBudget: number;
  contextPct: number;
  savedTokens: number;
  savedYuan: number;
}

export interface KeyInfo {
  id: 'glm' | 'minimax' | 'deepseek' | 'tavily';
  label: string;
  billing: 'subscription' | 'payg' | 'tool';
  defaultBaseURL: string;
  baseURL: string;
  hasKey: boolean;
  hint: string | null;
  source: 'credentials' | 'env' | 'none';
  models: number;
}

export interface CredentialsPayload {
  credentials: KeyInfo[];
  file: string;
  envFile: string;
  customProviders?: Array<{
    id: string; label: string; baseURL: string; billing: 'payg' | 'subscription';
    models: Array<{ id: string; label?: string; tier?: string }>; createdAt: string;
  }>;
}

export interface TestResult {
  ok: boolean;
  ms: number;
  message: string;
  models?: number;
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path}：${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function checkHealth(timeoutMs = 1200): Promise<HealthInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const h = await json<HealthInfo>('/api/health', { signal: controller.signal });
    return h;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 类型化端点 ----------
export const api = {
  sessions: () => json<{ sessions: Session[] }>('/api/sessions'),
  createSession: (title?: string, type: 'chat' | 'task' = 'chat') =>
    json<{ session: Session }>('/api/sessions', { method: 'POST', body: JSON.stringify({ title, type }) }),
  messages: (id: string) => json<{ messages: ChatMessage[] }>(`/api/sessions/${id}/messages`),
  checkpoints: (id: string) => json<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${id}/checkpoints`),
  restoreCheckpoint: (id: string) => json<{ ok: boolean; path?: string; message: string }>(`/api/checkpoints/${id}/restore`, { method: 'POST', body: '{}' }),
  files: (id: string, dir?: string) => json<{ roots: string[]; dir: string; entries: Array<{ name: string; path: string; dir: boolean; size: number }> }>(
    `/api/sessions/${id}/files${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`,
  ),
  file: (id: string, filePath: string) => json<{
    path: string; name: string; ext: string; size: number;
    kind: 'text' | 'image' | 'binary' | 'pdf'; text?: string; dataUrl?: string;
  }>(`/api/sessions/${id}/file?path=${encodeURIComponent(filePath)}`),
  fileUrl: (id: string, filePath: string) => `${baseUrl()}/api/sessions/${id}/raw?path=${encodeURIComponent(filePath)}`,
  sessionStats: (id: string) => json<{ stats: SessionStats }>(`/api/sessions/${id}/stats`),
  totalStats: () => json<{ inputTokens: number; outputTokens: number; totalTokens: number; messages: number }>('/api/stats/total'),
  usageStats: () => json<{
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    models: Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; totalTokens: number; calls: number }>;
  }>('/api/stats/usage'),
  stopSession: (id: string) => json<{ ok: boolean; note?: string }>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  exportSession: async (id: string): Promise<string> => {
    const res = await fetch(`${baseUrl()}/api/sessions/${id}/export`);
    if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`);
    return res.text();
  },
  providerPresets: () => json<{ presets: ProviderPreset[] }>('/api/provider-presets'),
  generateTitle: (id: string) => json<{ generated: boolean; title: string }>(`/api/sessions/${id}/title`, { method: 'POST', body: '{}' }),
  updateSession: (id: string, patch: { title?: string; workspace?: string; workspaces?: string[] }) =>
    json<{ ok: boolean; session: Session }>(`/api/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSession: (id: string) =>
    json<{ ok: boolean; removed: { messages: number; outputs: number; dir: string | null; keptWorkspace: boolean } }>(
      `/api/sessions/${id}`, { method: 'DELETE' }),
  bots: () => json<{ bots: Bot[] }>('/api/bots'),
  createBot: (b: Partial<Bot>) => json<{ bot: Bot }>('/api/bots', { method: 'POST', body: JSON.stringify(b) }),
  updateBot: (id: string, b: Partial<Bot>) => json<{ bot: Bot }>(`/api/bots/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteBot: (id: string) => json<{ ok: boolean }>(`/api/bots/${id}`, { method: 'DELETE' }),
  providers: () => json<{ providers: ProviderInfo[]; models: ModelInfo[]; deepseekPeriod: 'peak' | 'offpeak' }>('/api/providers'),
  quota: () => json<{ providers: QuotaSnapshot[] }>('/api/quota'),
  approvals: () => json<{ approvals: Approval[] }>('/api/approvals'),
  decideApproval: (id: string, decision: 'approved' | 'denied', scope: ApprovalScope = 'once') =>
    json<{ ok: boolean; scope: ApprovalScope }>(`/api/approvals/${id}/decide`, {
      method: 'POST', body: JSON.stringify({ decision, scope }),
    }),
  grants: () => json<{ grants: ToolGrant[]; sandbox: string; approval: string }>('/api/grants'),
  createGrant: (input: { tool: string; scope: 'session' | 'always'; sessionId?: string }) =>
    json<{ grants: ToolGrant[] }>('/api/grants', { method: 'POST', body: JSON.stringify(input) }),
  deleteGrant: (id: string) => json<{ grants: ToolGrant[] }>(`/api/grants/${id}`, { method: 'DELETE' }),
  context: (sessionId: string, botId?: string, model?: string) => {
    const q = new URLSearchParams({ sessionId });
    if (botId) q.set('botId', botId);
    if (model) q.set('model', model);
    return json<{ insight: ContextInsight }>(`/api/context?${q.toString()}`);
  },
  compactContext: (sessionId: string) =>
    json<{ ok: boolean; note: string; insight: ContextInsight }>('/api/context/compact', {
      method: 'POST', body: JSON.stringify({ sessionId }),
    }),
  plugins: () => json<PluginCatalog & { sandbox: string }>('/api/plugins'),
  uploadSkin: (dataUrl: string) => json<{ ok: boolean; settings: AppSettings; file: string }>('/api/skin', {
    method: 'POST', body: JSON.stringify({ dataUrl }),
  }),
  skinUrl: (v?: string) => skinUrl(v),
  deleteSkin: () => json<{ ok: boolean; settings: AppSettings }>('/api/skin', { method: 'DELETE' }),
  githubSources: () => json<{ sources: Array<{ id: string; label: string; url: string }> }>('/api/market/sources'),
  scanGitHub: (url: string) => json<{
    ok: boolean; owner: string; repo: string; branch: string; truncated: boolean;
    skills: Array<{ id: string; name: string; description: string; path: string; raw: string; installed: boolean }>;
  }>('/api/market/github/scan', { method: 'POST', body: JSON.stringify({ url }) }),
  installGitHubSkill: (url: string, skillPath: string) =>
    json<{ ok: boolean; id: string; dir: string }>('/api/market/github/install', {
      method: 'POST', body: JSON.stringify({ url, path: skillPath }),
    }),
  installPlugin: (id: string) => json<{ ok: boolean; plugin: PluginInfo }>(`/api/plugins/${id}/install`, { method: 'POST', body: '{}' }),
  uninstallPlugin: (id: string) => json<{ ok: boolean }>(`/api/plugins/${id}/uninstall`, { method: 'POST', body: '{}' }),
  togglePlugin: (id: string, enabled: boolean) =>
    json<{ ok: boolean; plugin: PluginInfo }>(`/api/plugins/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  credentials: () => json<CredentialsPayload>('/api/credentials'),
  saveCredential: (id: string, patch: { apiKey?: string; baseURL?: string }) =>
    json<CredentialsPayload & { ok: boolean }>(`/api/credentials/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  testCredential: (id: string, patch: { apiKey?: string; baseURL?: string }) =>
    json<TestResult>(`/api/credentials/${id}/test`, { method: 'POST', body: JSON.stringify(patch) }),
  addProvider: (input: {
    id?: string; label: string; baseURL: string; apiKey?: string;
    models: Array<{ id: string; label?: string; tier?: string }>;
    billing?: 'payg' | 'subscription';
  }) => json<{ ok: boolean; provider: unknown }>('/api/providers', { method: 'POST', body: JSON.stringify(input) }),
  deleteProvider: (id: string) =>
    json<{ ok: boolean }>(`/api/providers/${id}`, { method: 'DELETE' }),
  fetchProviderModels: (id: string, patch: { baseURL?: string; apiKey?: string }) =>
    json<{ ok: boolean; models: string[] }>(`/api/providers/${id}/models`, { method: 'POST', body: JSON.stringify(patch) }),
  skills: () => json<{ skills: SkillMeta[] }>('/api/skills'),
  scanSkills: () => json<{ skills: SkillMeta[]; count: number }>('/api/skills/scan', { method: 'POST' }),
  toggleSkill: (id: string, enabled: boolean) => json<{ ok: boolean }>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  routines: () => json<{ routines: Routine[]; runs: RoutineRun[]; bots: Array<{ id: string; name: string; emoji: string }> }>('/api/routines'),
  createRoutine: (r: { name: string; schedule: string; botId: string; prompt: string }) =>
    json<{ routine: Routine }>('/api/routines', { method: 'POST', body: JSON.stringify(r) }),
  updateRoutine: (id: string, patch: Partial<Routine>) =>
    json<{ routine: Routine }>(`/api/routines/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteRoutine: (id: string) => json<{ ok: boolean }>(`/api/routines/${id}`, { method: 'DELETE' }),
  runRoutine: (id: string) => json<{ status: string; summary: string }>(`/api/routines/${id}/run`, { method: 'POST' }),
  settings: () => json<{ settings: AppSettings }>('/api/settings'),
  saveSettings: (s: Partial<AppSettings>) => json<{ settings: AppSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

// ---------- SSE 聊天流 ----------
export async function streamChat(
  body: ChatRequest & { taskCard?: TaskCard },
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        // 忽略坏帧
      }
    }
  }
}
