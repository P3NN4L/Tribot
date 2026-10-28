// ===== 供应商预设（参考 DSH 的供应商清单，全部 OpenAI 兼容）=====
// builtin=true 表示注册表里已经有它的模型，添加时只需要填 Key；
// 其余会在添加时注册成自定义供应商。

export type PresetTier = 'flagship' | 'balanced' | 'fast';

export interface ProviderPreset {
  id: string;
  label: string;
  baseURL: string;
  billing: 'subscription' | 'payg';
  kind: 'model' | 'tool';
  builtin?: boolean;
  models: Array<{ id: string; label?: string; tier?: PresetTier }>;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1',
    billing: 'payg', kind: 'model', builtin: true,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', tier: 'balanced' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', tier: 'flagship' },
    ],
    note: '按量计费，低谷半价',
  },
  {
    id: 'glm', label: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    billing: 'subscription', kind: 'model', builtin: true,
    models: [
      { id: 'glm-5.3', label: 'GLM-5.3', tier: 'flagship' },
      { id: 'glm-5.2', label: 'GLM-5.2', tier: 'balanced' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', tier: 'fast' },
    ],
  },
  {
    id: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimaxi.com/v1',
    billing: 'subscription', kind: 'model', builtin: true,
    models: [
      { id: 'MiniMax-M3', label: 'MiniMax M3', tier: 'flagship' },
      { id: 'MiniMax-M2', label: 'MiniMax M2', tier: 'balanced' },
    ],
  },
  {
    id: 'kimi', label: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'kimi-k2', label: 'Kimi K2', tier: 'flagship' },
      { id: 'kimi-k2-turbo', label: 'Kimi K2 Turbo', tier: 'fast' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'flagship' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tier: 'balanced' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', tier: 'fast' },
    ],
  },
  {
    id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'openai/gpt-4.1', label: 'GPT-4.1', tier: 'flagship' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'flagship' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', tier: 'balanced' },
    ],
    note: '一个 Key 调多家模型',
  },
  {
    id: 'siliconflow', label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B', tier: 'flagship' },
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', tier: 'balanced' },
      { id: 'Qwen/Qwen3-8B', label: 'Qwen3 8B', tier: 'fast' },
    ],
  },
  {
    id: 'qwen', label: '通义千问（DashScope）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'qwen3-max', label: 'Qwen3 Max', tier: 'flagship' },
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder', tier: 'balanced' },
    ],
  },
  {
    id: 'gemini', label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'flagship' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast' },
    ],
  },
  {
    id: 'grok', label: 'xAI Grok', baseURL: 'https://api.x.ai/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'grok-4', label: 'Grok 4', tier: 'flagship' },
      { id: 'grok-3-mini', label: 'Grok 3 mini', tier: 'fast' },
    ],
  },
  {
    id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', tier: 'balanced' },
      { id: 'qwen/qwen3-32b', label: 'Qwen3 32B', tier: 'balanced' },
    ],
    note: '推理速度快',
  },
  {
    id: 'mistral', label: 'Mistral', baseURL: 'https://api.mistral.ai/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large', tier: 'flagship' },
      { id: 'mistral-small-latest', label: 'Mistral Small', tier: 'fast' },
    ],
  },
  {
    id: 'ollama', label: 'Ollama（本地）', baseURL: 'http://127.0.0.1:11434/v1',
    billing: 'payg', kind: 'model',
    models: [
      { id: 'qwen3:8b', label: 'qwen3:8b', tier: 'balanced' },
      { id: 'llama3.3', label: 'llama3.3', tier: 'balanced' },
    ],
    note: '本地模型，Key 随便填',
  },
  {
    id: 'lmstudio', label: 'LM Studio（本地）', baseURL: 'http://127.0.0.1:1234/v1',
    billing: 'payg', kind: 'model',
    models: [{ id: 'local-model', label: '本地模型', tier: 'balanced' }],
    note: '本地模型，Key 随便填',
  },
  {
    id: 'tavily', label: 'Tavily（联网搜索）', baseURL: 'https://api.tavily.com',
    billing: 'payg', kind: 'tool', builtin: true, models: [],
    note: '只用于 web_search 工具',
  },
];

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
