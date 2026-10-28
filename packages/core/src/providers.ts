import fs from 'node:fs';
import path from 'node:path';
import type { CustomProvider, ModelTier } from '@tribot/shared';

// ===== 自定义供应商（Kimi / OpenAI / 本地 Ollama…）=====
// 存在 data/providers.json；内置三家不在这个文件里，是注册表的底座。

export const RESERVED_PROVIDER_IDS = new Set(['glm', 'minimax', 'deepseek', 'tavily']);

export function providersPath(dataDir: string): string {
  return path.join(dataDir, 'providers.json');
}

export function isValidProviderId(id: string): boolean {
  return /^[a-z][a-z0-9_-]{1,23}$/.test(id) && !RESERVED_PROVIDER_IDS.has(id);
}

export function slugifyProviderId(input: string): string {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (!base) return `custom-${Math.random().toString(36).slice(2, 6)}`;
  return /^[a-z]/.test(base) ? base : `p-${base}`;
}

export function normalizeProvider(input: Partial<CustomProvider> & { id?: string }): CustomProvider {
  const id = input.id && isValidProviderId(input.id) ? input.id : slugifyProviderId(input.label ?? input.id ?? '');
  const rawLabel = String(input.label ?? '').trim() || id;
  const baseURL = String(input.baseURL ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseURL)) throw new Error('Base URL 必须以 http(s):// 开头');

  const seen = new Set<string>();
  const models: CustomProvider['models'] = [];
  for (const m of input.models ?? []) {
    const mid = String(m?.id ?? '').trim();
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const tier: ModelTier = m.tier === 'flagship' || m.tier === 'fast' ? m.tier : 'balanced';
    models.push({
      id: mid,
      label: String(m.label ?? '').trim() || mid,
      tier,
      ...(m.pricing ? { pricing: { input: Number(m.pricing.input) || 0, output: Number(m.pricing.output) || 0 } } : {}),
    });
  }
  if (models.length === 0) throw new Error('至少给一个模型 id');

  return {
    id,
    label: rawLabel,
    baseURL,
    billing: input.billing === 'subscription' ? 'subscription' : 'payg',
    models: models.slice(0, 50),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function loadCustomProviders(dataDir: string): CustomProvider[] {
  try {
    const raw = JSON.parse(fs.readFileSync(providersPath(dataDir), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.providers) ? raw.providers : [];
    const out: CustomProvider[] = [];
    for (const item of list) {
      try {
        const p = normalizeProvider(item);
        if (isValidProviderId(p.id)) out.push(p);
      } catch { /* 跳过坏条目 */ }
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustomProviders(dataDir: string, providers: CustomProvider[]): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(providersPath(dataDir), JSON.stringify({ version: 1, providers }, null, 2), 'utf8');
}

export function upsertCustomProvider(list: CustomProvider[], provider: CustomProvider): CustomProvider[] {
  const idx = list.findIndex((p) => p.id === provider.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...provider, createdAt: list[idx].createdAt };
    return next;
  }
  return [...list, provider];
}

export function removeCustomProvider(list: CustomProvider[], id: string): CustomProvider[] {
  return list.filter((p) => p.id !== id);
}
