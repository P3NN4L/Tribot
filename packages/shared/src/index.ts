// ===== TriBot 共享类型（server / app / cli 三端通用）=====

// 内置三家；自定义供应商（Kimi / OpenAI / 本地 Ollama…）也走同一个 id 空间
export type BuiltinProviderId = 'glm' | 'minimax' | 'deepseek';
export type ProviderId = BuiltinProviderId | (string & {});
export type RoutingMode = 'auto' | 'manual' | 'failover' | 'compare';
export type ModelTier = 'flagship' | 'balanced' | 'fast';
export type RiskLevel = 'low' | 'medium' | 'high';
/** 沙箱分级：只读 / 工作区（可写文件、命令仍需审批）/ 全权（中危自动放行） */
export type SandboxMode = 'read_only' | 'workspace' | 'full';
/** 思考程度：快问快答 / 标准 / 深度推理 */
export type ThinkingEffort = 'fast' | 'standard' | 'deep';

export const THINKING_EFFORT_RANK: Record<ThinkingEffort, number> = { fast: 0, standard: 1, deep: 2 };

export interface ThinkingTrigger {
  effort: ThinkingEffort;
  label: string;
  matched: string;
}

// 思考触发词（Claude Code 的 think / think hard / ultrathink 那套）：只升不降
const THINKING_TRIGGERS: Array<{ re: RegExp; effort: ThinkingEffort; label: string }> = [
  { re: /(?:\bultrathink\b|极限思考|超深度思考|往死里想)/i, effort: 'deep', label: 'ultrathink' },
  { re: /(?:\bthink\s+(?:hard|harder|more)\b|深入思考|深度思考|仔细想|多想想|认真推敲)/i, effort: 'deep', label: 'think hard' },
  { re: /(?:\bthink\b|想一想|琢磨一下|推敲一下)/i, effort: 'standard', label: 'think' },
];

export function detectThinkingTrigger(text?: string | null): ThinkingTrigger | null {
  const t = String(text ?? '');
  if (!t) return null;
  for (const rule of THINKING_TRIGGERS) {
    const m = rule.re.exec(t);
    if (m) return { effort: rule.effort, label: rule.label, matched: m[0] };
  }
  return null;
}

export function raiseThinkingEffort(base: ThinkingEffort, target: ThinkingEffort): ThinkingEffort {
  return THINKING_EFFORT_RANK[target] > THINKING_EFFORT_RANK[base] ? target : base;
}
/** 一次授权的作用域：仅本次 / 本会话 / 永久 */
export type ApprovalScope = 'once' | 'session' | 'always';

export interface ToolGrant {
  id: string;
  tool: string;
  scope: 'session' | 'always';
  /** scope=session 时限定会话 */
  sessionId?: string;
  createdAt: string;
  note?: string;
}

export interface ModelInfo {
  id: string; // 完整模型 id（发给 API 的名字）
  provider: ProviderId;
  label: string; // 界面显示名
  tier: ModelTier;
  pricing?: { input: number; output: number }; // 每百万 tokens，人民币估算
  notes?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  billing: 'subscription' | 'payg'; // 订阅制 / 按量付费
  hasKey: boolean;
  models: ModelInfo[];
  /** 用户自己加的供应商（Kimi / OpenAI / 本地…） */
  custom?: boolean;
  baseURL?: string;
}

export interface CustomProvider {
  id: string;
  label: string;
  /** OpenAI 兼容根地址，例如 https://api.moonshot.cn/v1 */
  baseURL: string;
  billing: 'payg' | 'subscription';
  models: Array<{ id: string; label?: string; tier?: ModelTier; pricing?: { input: number; output: number } }>;
  createdAt: string;
}

// ---------- 配额 ----------

export interface QuotaSnapshot {
  provider: ProviderId;
  billing: 'subscription' | 'payg';
  remote?: { ok: boolean; detail?: string; raw?: unknown };
  /** 本地自计量（最可靠的兜底） */
  meter: {
    window5hTokens: number;
    weeklyTokens: number;
    window5hLimit?: number;
    weeklyLimit?: number;
  };
  /** DeepSeek 专属 */
  balance?: { amount: number; currency: string };
  deepseekPeriod?: 'peak' | 'offpeak';
  /** 订阅档位（如智谱 pro） */
  planLevel?: string;
  /** 远程真实 token 用量（智谱 model-usage 接口） */
  usage5hTokens?: number;
  usageWeeklyTokens?: number;
  /** 套餐数据缺失时的说明，如 MiniMax 未返回计数 */
  planNote?: string;
  checkedAt: string;
}

// ---------- Bot / 会话 / 消息 ----------

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  role: string;
  systemPrompt: string;
  tools: string[]; // 工具白名单，['*'] 表示全部
  modelPref?: string; // 锁定模型 id
  thinking?: ThinkingEffort; // 该 Bot 的默认思考程度
  builtin: boolean;
  createdAt: string;
}

export interface TaskCard {
  goal: string;
  sources?: string;
  constraints?: string;
  deliverable?: string;
  reviewPoint?: string;
}

export interface Session {
  id: string;
  title: string;
  type: 'chat' | 'task';
  createdAt: string;
  updatedAt: string;
  meta?: {
    summary?: string;
    taskCard?: TaskCard;
    /** 这个会话（任务）的工作目录；空则退回 Bot 默认工作区 */
    workspace?: string;
    /** 多目录：第一个是主目录，其余是附加目录 */
    workspaces?: string[];
    /** 标题来源：自定义后不再自动生成 */
    titleSource?: 'default' | 'first_input' | 'generated' | 'custom';
    [k: string]: unknown;
  };
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  botId?: string;
  botName?: string;
  content: string;
  provider?: ProviderId;
  model?: string;
  routeReason?: string;
  degraded?: boolean;
  compareIndex?: number; // 对比模式下第几栏
  thinking?: ThinkingEffort;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; latencyMs?: number };
  createdAt: string;
}

// ---------- 审批 ----------

export interface Approval {
  id: string;
  sessionId: string;
  botName: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  createdAt: string;
}

// ---------- Skill ----------

export interface SkillMeta {
  id: string; // 目录名
  name: string;
  description: string;
  dir: string;
  source: string;
  enabled: boolean;
  hasScripts: boolean;
}

// ---------- Routine ----------

export interface Routine {
  id: string;
  name: string;
  schedule: string; // 五段 cron（本地时区）
  botId: string;
  prompt: string;
  sessionId: string;
  enabled: boolean;
  /** 只在 DeepSeek 低谷时段执行（半价） */
  offpeakOnly?: boolean;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error' | 'running';
}

export interface RoutineRun {
  id: number;
  routineId: string;
  ts: string;
  status: 'ok' | 'error';
  summary: string;
}

// ---------- 上下文洞察 ----------

export interface ContextPart {
  key: 'system' | 'tools' | 'skills' | 'task' | 'summary' | 'history' | 'omitted' | 'saved';
  label: string;
  tokens: number;
  detail?: string;
}

export interface ContextInsight {
  sessionId: string;
  botId: string;
  botName: string;
  model?: string;
  /** 该模型可用的上下文预算（tokens，估算） */
  budget: number;
  /** 本次实际会发出去的量（tokens，估算） */
  used: number;
  parts: ContextPart[];
  historyTotal: number;
  historyIncluded: number;
  skills: number;
  tools: number;
  /** 工具输出被压缩的次数与省下的 token（估算） */
  compactions: number;
  savedTokens: number;
  /** 本会话累计省下的 token 与折合金额（按当前模型输入价估算） */
  savings: {
    spillTokens: number;
    summaryTokens: number;
    totalTokens: number;
    costSavedYuan: number;
    pricePerMTok: number;
  };
  summarized: boolean;
  summaryChars: number;
  /** 可执行的优化建议 */
  suggestions: string[];
  updatedAt: string;
}

// ---------- 插件市场 ----------

export type PluginCategory = 'research' | 'writing' | 'engineering' | 'data' | 'ops';

export interface PluginInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  category: PluginCategory;
  description: string;
  tags: string[];
  highlights: string[];
  kind: 'skill';
  installed: boolean;
  enabled: boolean;
  /** 目录内的“安装量”，仅作展示 */
  installs: number;
  skillId?: string;
  bytes?: number;
}

export interface PluginCatalog {
  plugins: PluginInfo[];
  installed: number;
  categories: Array<{ id: PluginCategory; label: string; count: number }>;
}

// ---------- 设置 ----------

export const SKIN_PRESETS: Array<{ id: string; label: string; css: string }> = [
  {
    id: 'dusk', label: '暮色',
    css: 'radial-gradient(120% 90% at 15% 0%, #3a2b1c 0%, #14100c 55%, #0b0908 100%)',
  },
  {
    id: 'ember', label: '余烬',
    css: 'radial-gradient(90% 80% at 85% 15%, #4a2a16 0%, #1a0f09 55%, #0a0806 100%)',
  },
  {
    id: 'teal', label: '深青',
    css: 'linear-gradient(135deg, #0e1c1b 0%, #0b1211 60%, #080a0a 100%)',
  },
  {
    id: 'graphite', label: '石墨',
    css: 'linear-gradient(120deg, #1a1a1c 0%, #101012 55%, #0a0a0b 100%)',
  },
];

export interface AppSettings {
  routing: {
    mode: RoutingMode;
    manualModel?: string;
    compareModels: string[];
  };
  approval: 'ask_first' | 'auto';
  /** 沙箱分级：决定 Bot 能主动做多少事 */
  sandbox: SandboxMode;
  /** 已授予的工具权限（审批作用域为「本会话 / 永久」时写入） */
  grants: ToolGrant[];
  /** 思考程度默认值（每个 Bot 也可覆盖） */
  thinking: { default: ThinkingEffort };
  /** 模型可用性：null = 全部可用；数组 = 只有这些模型可被路由与手动选择 */
  models: {
    enabled: string[] | null;
    /** 我默认使用的模型；空 = 跟随自动路由 */
    default?: string;
    /** 每个供应商从 /models 拉取并勾选的模型（补进注册表） */
    catalogs?: Record<string, string[]>;
  };
  commandWhitelist: string[];
  /** 外观：跟随系统 / 深色 / 浅色 */
  theme: 'auto' | 'dark' | 'light';
  /** 自定义皮肤：上传一张图当背景 */
  skin: {
    enabled: boolean;
    /** 服务端 data/skins 下的文件名 */
    file?: string;
    /** 内置预设 id（与 file 二选一） */
    preset?: string;
    /** 图片不透明度 0.05 ~ 0.8 */
    opacity: number;
    /** 模糊半径 px */
    blur: number;
  };
  /** 订阅套餐限额（tokens），用于配额感知路由 */
  planLimits: Record<ProviderId, { window5hTokens?: number; weeklyTokens?: number }>;
  skillDirs: string[];
  search: { provider: 'tavily' | 'off'; maxResults: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  routing: { mode: 'auto', compareModels: [] },
  approval: 'ask_first',
  sandbox: 'workspace',
  grants: [],
  thinking: { default: 'standard' },
  models: { enabled: null },
  commandWhitelist: ['node', 'npm', 'pnpm', 'npx', 'git', 'python', 'py', 'pip', 'ls', 'dir', 'cat', 'type', 'echo', 'rg', 'findstr', 'find', 'grep'],
  theme: 'auto',
  skin: { enabled: false, opacity: 0.32, blur: 0 },
  planLimits: {
    glm: { window5hTokens: undefined, weeklyTokens: undefined },
    minimax: { window5hTokens: undefined, weeklyTokens: undefined },
    deepseek: {},
  },
  skillDirs: [],
  search: { provider: 'tavily', maxResults: 5 },
};

// ---------- 聊天请求与 SSE 事件 ----------

export interface ChatRequest {
  sessionId: string;
  content: string;
  botId?: string;
  mode?: RoutingMode;
  model?: string; // manual 模式指定
  compareModels?: string[];
  taskCard?: TaskCard;
  thinking?: ThinkingEffort;
  /** 计划模式：先出计划、等用户批准再执行（对齐 DSH 的 /plan） */
  plan?: boolean;
}

export interface CheckpointInfo {
  id: string;
  sessionId: string;
  tool: string;
  path: string;
  existed: boolean;
  createdAt: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  status?: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

export type StreamEvent =
  | { type: 'start'; sessionId: string; botId?: string; botName?: string }
  | { type: 'notice'; level: 'info' | 'warn'; message: string }
  | { type: 'plan'; plan: string }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'route'; provider: ProviderId; model: string; reason: string; degraded?: boolean; attempt?: number }
  | { type: 'token'; text: string; channel?: 'reasoning' | 'answer' }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; ok: boolean; preview: string }
  | { type: 'approval_request'; approval: Approval }
  | { type: 'assign'; fromBot: string; toBot: string; instruction: string }
  | { type: 'message_done'; message: ChatMessage }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      usage?: { inputTokens: number; outputTokens: number; costEst: number };
      degraded?: boolean;
    };

export interface HealthInfo {
  ok: boolean;
  version: string;
  port: number;
  keys: Record<ProviderId, boolean>;
  dataDir: string;
}
