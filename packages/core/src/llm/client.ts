import type { ProviderId } from '@tribot/shared';

// ===== 统一的 LLM 消息/工具类型（OpenAI 兼容格式）=====

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export type ErrorKind =
  | 'rate_limit'
  | 'quota'
  | 'auth'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad_request'
  | 'aborted'
  | 'other';

export class ProviderError extends Error {
  kind: ErrorKind;
  status?: number;
  provider?: ProviderId;
  constructor(message: string, kind: ErrorKind, status?: number, provider?: ProviderId) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.provider = provider;
  }
}

/** 降级链应该跳过该 provider 的错误类型 */
export function isFailoverWorthy(e: unknown): boolean {
  if (e instanceof ProviderError) {
    return ['rate_limit', 'quota', 'timeout', 'network', 'server', 'auth'].includes(e.kind);
  }
  return false;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number; latencyMs?: number };
}

export interface ChatOptions {
  provider: ProviderId;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** 智谱 GLM 专用：disabled 关闭推理，能显著降低首字延迟 */
  thinking?: 'enabled' | 'disabled';
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (text: string, channel: 'reasoning' | 'answer') => void;
}

function classifyStatus(status: number, body: string): ErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'server';
  void body;
  return 'other';
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

/** 调 OpenAI 兼容 /chat/completions（流式），返回完整结果 */
export async function chatStream(opts: ChatOptions): Promise<ChatResult> {
  const {
    provider, baseURL, apiKey, model, messages, tools, temperature, maxTokens,
    timeoutMs = 180_000, signal, onDelta,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        ...(provider === 'glm' && opts.thinking ? { thinking: { type: opts.thinking } } : {}),
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError' || /timeout/i.test(String(e?.message || e))) {
      return Promise.reject(new ProviderError(`${provider} 请求超时（${timeoutMs}ms）`, 'timeout', undefined, provider));
    }
    return Promise.reject(new ProviderError(`${provider} 网络错误：${e?.message ?? e}`, 'network', undefined, provider));
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    clearTimeout(timer);
    const kind = classifyStatus(res.status, text);
    // 部分服务在 4xx body 里写明额度问题
    const isQuota = /balance|quota|insufficient|欠费|额度/i.test(text);
    return Promise.reject(new ProviderError(
      `${provider} HTTP ${res.status}：${text.slice(0, 300)}`,
      isQuota ? 'quota' : kind,
      res.status,
      provider,
    ));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number; latencyMs?: number } | undefined;
  // tool_calls 增量按 index 聚合
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  const handleChunk = (payload: string) => {
    if (payload === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    if (json.usage) {
      // 各家缓存字段名不一样：DeepSeek 用 prompt_cache_hit_tokens，OpenAI 兼容用
      // prompt_tokens_details.cached_tokens，Anthropic 风格用 cache_read_input_tokens
      const cached = json.usage.prompt_cache_hit_tokens
        ?? json.usage.prompt_tokens_details?.cached_tokens
        ?? json.usage.cache_read_input_tokens
        ?? json.usage.cached_tokens
        ?? 0;
      usage = {
        inputTokens: json.usage.prompt_tokens ?? 0,
        outputTokens: json.usage.completion_tokens ?? 0,
        cachedTokens: Number(cached) || 0,
        latencyMs: Date.now() - startedAt,
      };
    }
    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onDelta?.(delta.reasoning_content, 'reasoning');
    }
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onDelta?.(delta.content, 'answer');
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        handleChunk(line.slice(5).trim());
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) handleChunk(tail.slice(5).trim());
  } catch (e: any) {
    if (!content && toolAcc.size === 0) {
      return Promise.reject(new ProviderError(`${provider} 流读取中断：${e?.message ?? e}`, 'network', undefined, provider));
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  const toolCalls: ChatResult['toolCalls'] = [];
  for (const [idx, tc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    if (!tc.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      args = { _raw: tc.args };
    }
    toolCalls.push({ id: tc.id || `call_${idx}_${Date.now()}`, name: tc.name, args });
  }

  if (!content && toolCalls.length === 0) {
    return Promise.reject(new ProviderError(`${provider} 返回空内容`, 'server', undefined, provider));
  }

  return {
    content,
    reasoning,
    toolCalls,
    usage: usage ?? {
      inputTokens: estimateTokens(messages.map((m) => m.content ?? '').join('')),
      outputTokens: estimateTokens(content),
      cachedTokens: 0,
      latencyMs: Date.now() - startedAt,
    },
  };
}
