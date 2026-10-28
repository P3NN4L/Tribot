import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isValidProviderId, loadCustomProviders, normalizeProvider, removeCustomProvider,
  saveCustomProviders, slugifyProviderId, upsertCustomProvider,
} from '../src/providers.js';
import { DEFAULT_MODELS, ModelRegistry } from '../src/llm/registry.js';
import type { EnvConfig } from '../src/config.js';

// ===== 自定义供应商：Kimi / OpenAI / 本地 Ollama 走同一套结构 =====

const kimi = () => normalizeProvider({
  id: 'kimi',
  label: 'Kimi',
  baseURL: 'https://api.moonshot.cn/v1/',
  models: [{ id: 'kimi-k2', tier: 'flagship' }, { id: 'kimi-k2-turbo' }, { id: 'kimi-k2', tier: 'fast' }],
});

describe('供应商规范化', () => {
  it('去掉 Base URL 尾部斜杠、模型去重、默认档位 balanced', () => {
    const p = kimi();
    expect(p.baseURL).toBe('https://api.moonshot.cn/v1');
    expect(p.models.map((m) => m.id)).toEqual(['kimi-k2', 'kimi-k2-turbo']);
    expect(p.models[0].tier).toBe('flagship');
    expect(p.models[1].tier).toBe('balanced');
  });

  it('非法 Base URL 直接拒绝', () => {
    expect(() => normalizeProvider({ id: 'x', label: 'X', baseURL: 'api.x.com', models: [{ id: 'm' }] })).toThrow('http');
  });

  it('没有模型就拒绝', () => {
    expect(() => normalizeProvider({ id: 'x', label: 'X', baseURL: 'https://x.com', models: [] })).toThrow('模型');
  });

  it('内置 id 不能占用；自定义 id 合法', () => {
    expect(isValidProviderId('glm')).toBe(false);
    expect(isValidProviderId('deepseek')).toBe(false);
    expect(isValidProviderId('tavily')).toBe(false);
    expect(isValidProviderId('kimi')).toBe(true);
    expect(isValidProviderId('my_proxy-1')).toBe(true);
  });

  it('中文名也能生成安全 slug', () => {
    expect(slugifyProviderId('月之暗面 Kimi')).toMatch(/^[a-z][a-z0-9_-]*$/);
  });
});

describe('供应商落盘与增删', () => {
  let tmp: string;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tribot-providers-')); });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('保存后能读回，可更新可删除', () => {
    const one = upsertCustomProvider([], kimi());
    saveCustomProviders(tmp, one);
    expect(loadCustomProviders(tmp).map((p) => p.id)).toEqual(['kimi']);

    const updated = upsertCustomProvider(one, normalizeProvider({
      id: 'kimi', label: 'Kimi 新版', baseURL: 'https://api.moonshot.cn/v1', models: [{ id: 'kimi-k3' }],
    }));
    expect(updated.length).toBe(1);
    expect(updated[0].label).toBe('Kimi 新版');
    expect(updated[0].createdAt).toBe(one[0].createdAt); // 保留创建时间

    saveCustomProviders(tmp, removeCustomProvider(updated, 'kimi'));
    expect(loadCustomProviders(tmp)).toEqual([]);
  });

  it('文件不存在时返回空数组', () => {
    expect(loadCustomProviders(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe('注册表合并自定义供应商', () => {
  const env = {
    root: '', dataDir: '', port: 1, packaged: false, keys: { kimi: 'sk-kimi' },
  } as unknown as EnvConfig;
  const registry = new ModelRegistry(env, { customProviders: [kimi()] });

  it('模型清单 = 内置 + 自定义', () => {
    expect(registry.allModels().length).toBe(DEFAULT_MODELS.length + 2);
    expect(registry.modelsOfProvider('kimi').length).toBe(2);
  });

  it('baseURL 走自定义供应商', () => {
    expect(registry.baseURL('kimi')).toBe('https://api.moonshot.cn/v1');
    expect(registry.baseURL('deepseek')).toContain('api.deepseek.com');
  });

  it('providerInfos 标出 custom 与 hasKey', () => {
    const p = registry.providerInfos(env).find((x) => x.id === 'kimi')!;
    expect(p.custom).toBe(true);
    expect(p.hasKey).toBe(true);
    expect(p.billing).toBe('payg');
  });

  it('setCustomProviders 之后立即生效（删除后模型消失）', () => {
    registry.setCustomProviders([]);
    expect(registry.modelsOfProvider('kimi').length).toBe(0);
    expect(registry.allModels().length).toBe(DEFAULT_MODELS.length);
    registry.setCustomProviders([kimi()]);
    expect(registry.modelsOfProvider('kimi').length).toBe(2);
  });

  it('catalog 模型补进注册表，清空后移除', () => {
    const reg = new ModelRegistry(env, { customProviders: [] });
    reg.setCatalogModels({ kimi: ['kimi-k3'] });
    expect(reg.findModel('kimi-k3')?.provider).toBe('kimi');
    expect(reg.findModel('kimi-k3')?.tier).toBe('balanced');
    // 有 catalog 时只保留拉取过的模型，不再混入内置默认
    expect(reg.allModels().every((m) => m.provider === 'kimi')).toBe(true);
    reg.setCatalogModels({});
    expect(reg.findModel('kimi-k3')).toBeUndefined();
    expect(reg.findModel('glm-5.3')).toBeTruthy();
  });
});
