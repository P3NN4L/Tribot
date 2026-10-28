import type { CustomProvider, ModelInfo, ProviderId, ProviderInfo } from '@tribot/shared';
import type { EnvConfig } from '../config.js';

// ===== 供应商注册表：内置三家 + 用户自己加的（Kimi / OpenAI / 本地 Ollama…）=====
// 全部 OpenAI 兼容：只需要 baseURL + key + 模型 id 列表。

export interface ProviderDef {
  id: ProviderId;
  label: string;
  billing: 'subscription' | 'payg';
  baseURL: string;
  custom: boolean;
}

export const PROVIDER_DEFS: Record<'glm' | 'minimax' | 'deepseek', ProviderDef> = {
  glm: {
    id: 'glm', label: '智谱 GLM', billing: 'subscription',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4', custom: false,
  },
  minimax: {
    id: 'minimax', label: 'MiniMax', billing: 'subscription',
    baseURL: 'https://api.minimaxi.com/v1', custom: false,
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', billing: 'payg',
    baseURL: 'https://api.deepseek.com/v1', custom: false,
  },
};

export const DEFAULT_MODELS: ModelInfo[] = [
  // GLM
  { id: 'glm-5.3', provider: 'glm', label: 'GLM-5.3', tier: 'flagship', pricing: { input: 8, output: 28 } },
  { id: 'glm-5.2', provider: 'glm', label: 'GLM-5.2', tier: 'balanced', pricing: { input: 4, output: 16 } },
  { id: 'glm-5.3-flash', provider: 'glm', label: 'GLM-5.3 Flash', tier: 'fast', pricing: { input: 1, output: 3 } },
  // MiniMax（订阅 Token Plan，边际成本低）
  { id: 'MiniMax-M3', provider: 'minimax', label: 'MiniMax M3', tier: 'flagship', pricing: { input: 2.2, output: 8.6 } },
  { id: 'MiniMax-M2', provider: 'minimax', label: 'MiniMax M2', tier: 'balanced', pricing: { input: 2.2, output: 8.6 }, notes: 'Agent 向 · 长上下文' },
  // DeepSeek（按量 · 峰谷计费，价格字段为高峰价，低谷五折）
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat', tier: 'balanced', pricing: { input: 0.5, output: 2.2 }, notes: '按量 · 峰谷' },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek Reasoner', tier: 'flagship', pricing: { input: 0.5, output: 2.2 }, notes: '按量 · 峰谷 · 深度推理' },
];

export interface RegistryOptions {
  /** 设置里的覆盖项：自定义 baseURL / 模型清单 */
  providerOverrides?: Partial<Record<string, { baseURL?: string; models?: ModelInfo[] }>>;
  models?: ModelInfo[]; // 完全自定义模型清单（不再合并内置）
  customProviders?: CustomProvider[];
}

export class ModelRegistry {
  private models: ModelInfo[] = [];
  private overrides: RegistryOptions['providerOverrides'];
  private custom: CustomProvider[] = [];
  /** 每个供应商「已拉取并选择」的模型；没有的供应商用内置模型 */
  private catalogs: Record<string, string[]> = {};

  constructor(env: EnvConfig, opts: RegistryOptions = {}) {
    void env;
    this.overrides = opts.providerOverrides;
    if (opts.models) {
      this.models = opts.models;
      this.custom = opts.customProviders ?? [];
    } else {
      this.setCustomProviders(opts.customProviders ?? []);
    }
  }

  /** 换一批自定义供应商（增删改后调用，立即生效） */
  setCustomProviders(list: CustomProvider[]): void {
    this.custom = list;
    this.rebuild();
  }

  /** 用户从供应商 /models 里勾选的模型（补进注册表，档位默认 balanced） */
  setCatalogModels(catalogs?: Record<string, string[]>): void {
    this.catalogs = catalogs && typeof catalogs === 'object' ? catalogs : {};
    this.rebuild();
  }

  private rebuild(): void {
    const catalogEntries = Object.entries(this.catalogs).filter(([, ids]) => Array.isArray(ids) && ids.length > 0);
    const hasCatalog = catalogEntries.length > 0;
    const merged: ModelInfo[] = [];
    const seen = new Set<string>();
    const push = (m: ModelInfo) => {
      const key = `${m.provider}:${m.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(m);
    };

    // 有 catalog（用户拉取过模型）时，只保留拉取并勾选的模型；
    // 没有任何 catalog 时退回内置清单，保证老用户仍可用。
    if (!hasCatalog) {
      for (const m of DEFAULT_MODELS) push({ ...m });
    } else {
      for (const [pid, ids] of catalogEntries) {
        for (const id of ids) {
          const def = DEFAULT_MODELS.find((d) => d.provider === pid && d.id === id);
          push(def ? { ...def } : { id, provider: pid, label: id, tier: 'balanced' });
        }
      }
    }

    // 自定义供应商的模型是用户显式添加的，始终保留
    for (const p of this.custom) {
      for (const m of p.models) {
        push({ id: m.id, provider: p.id, label: m.label || m.id, tier: m.tier ?? 'balanced', pricing: m.pricing });
      }
    }
    this.models = merged;
  }

  customProviders(): CustomProvider[] {
    return this.custom;
  }

  isCustom(pid: ProviderId): boolean {
    return this.custom.some((p) => p.id === pid);
  }

  allModels(): ModelInfo[] {
    return this.models;
  }

  findModel(id: string): ModelInfo | undefined {
    return this.models.find((m) => m.id === id);
  }

  modelsOfProvider(pid: ProviderId): ModelInfo[] {
    return this.models.filter((m) => m.provider === pid);
  }

  providerDef(pid: ProviderId): ProviderDef | undefined {
    const builtin = (PROVIDER_DEFS as Record<string, ProviderDef>)[pid];
    if (builtin) return builtin;
    const c = this.custom.find((p) => p.id === pid);
    if (!c) return undefined;
    return { id: c.id, label: c.label, billing: c.billing, baseURL: c.baseURL, custom: true };
  }

  allProviderIds(): ProviderId[] {
    return [...Object.keys(PROVIDER_DEFS), ...this.custom.map((p) => p.id)];
  }

  baseURL(pid: ProviderId): string {
    return this.overrides?.[pid]?.baseURL ?? this.providerDef(pid)?.baseURL ?? '';
  }

  apiKey(env: EnvConfig, pid: ProviderId): string | undefined {
    return env.keys[pid];
  }

  providerInfos(env: EnvConfig): ProviderInfo[] {
    return this.allProviderIds().map((pid) => {
      const def = this.providerDef(pid)!;
      return {
        id: pid,
        label: def.label,
        billing: def.billing,
        hasKey: !!this.apiKey(env, pid),
        models: this.modelsOfProvider(pid),
        custom: def.custom || undefined,
        baseURL: def.baseURL,
      };
    });
  }
}
