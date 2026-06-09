/**
 * provider-map.ts — providerType → (provider, api) 映射模块
 *
 * pi-ai 区分两个概念：
 *   - `provider`：身份标识，用于 API Key 查找（如 'deepseek', 'openai'）
 *   - `api`：协议类型，用于选择 API 实现（如 'openai-completions', 'anthropic-messages'）
 *
 * 项目的 providerType 字段将二者混为一谈，此模块在运行时完成正确拆分。
 */

import type { Model } from '@earendil-works/pi-ai';

/** 已知的 providerType → { provider, api } 映射，含默认 baseUrl */
const PROVIDER_TYPE_MAP: Record<string, { provider: string; api: string; baseUrl: string }> = {
  'openai-completions':     { provider: 'openai',     api: 'openai-completions',     baseUrl: 'https://api.openai.com' },
  'openai-responses':       { provider: 'openai',     api: 'openai-responses',       baseUrl: 'https://api.openai.com' },
  'anthropic-messages':     { provider: 'anthropic',  api: 'anthropic-messages',     baseUrl: 'https://api.anthropic.com' },
  'deepseek':               { provider: 'deepseek',   api: 'openai-completions',     baseUrl: 'https://api.deepseek.com' },
  'mistral-conversations':  { provider: 'mistral',    api: 'mistral-conversations',  baseUrl: 'https://api.mistral.ai' },
  'google-generative-ai':   { provider: 'google',     api: 'google-generative-ai',   baseUrl: '' },
  'google-vertex':          { provider: 'google-vertex', api: 'google-vertex',       baseUrl: '' },
  'bedrock-converse-stream':{ provider: 'amazon-bedrock', api: 'bedrock-converse-stream', baseUrl: '' },
  'azure-openai-responses': { provider: 'azure-openai-responses', api: 'azure-openai-responses', baseUrl: '' },
};

/** 已知的 API 协议后缀，用于 heuristic fallback */
const KNOWN_API_SUFFIXES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'mistral-conversations',
  'google-generative-ai',
  'bedrock-converse-stream',
  'azure-openai-responses',
];

/**
 * 将项目的 providerType 拆分为 pi-ai 所需的 provider + api
 *
 * 1. 精确匹配映射表
 * 2. 若 providerType 以已知 API 后缀结尾，截取前缀为 provider
 * 3. 兜底：provider 和 api 均使用原值（兼容自定义 providerType）
 */
export function resolveProviderApi(providerType: string): { provider: string; api: string; defaultBaseUrl: string } {
  const mapped = PROVIDER_TYPE_MAP[providerType];
  if (mapped) return { provider: mapped.provider, api: mapped.api, defaultBaseUrl: mapped.baseUrl };

  // heuristic: providerType 可能是 "<provider>-<api-suffix>"
  for (const suffix of KNOWN_API_SUFFIXES) {
    if (providerType.endsWith('-' + suffix)) {
      const provider = providerType.slice(0, providerType.length - suffix.length - 1);
      if (provider) return { provider, api: suffix, defaultBaseUrl: '' };
    }
  }

  // fallback: 直接用 providerType 作为 api，截取第一段作为 provider
  return { provider: providerType, api: providerType, defaultBaseUrl: '' };
}

/**
 * 从默认模型信息构建 pi-ai 所需的 model 对象
 *
 * 使用 as any 因为 Model<T> 的泛型约束在 SDK 外部难以精确满足，
 * 但运行时对象结构完全正确。
 */
export function buildModel(info: {
  providerType: string;
  modelId: string;
  name?: string;
  baseUrl?: string;
}): Model<any> {
  const { provider, api, defaultBaseUrl } = resolveProviderApi(info.providerType);
  let baseUrl = info.baseUrl || defaultBaseUrl || '';
  // Mistral SDK 内部路径模板为 "v1/chat/completions#stream"（相对路径），
  // 若 baseUrl 也包含路径（如 /v1），拼接后会产生双路径导致 404。
  // 统一剥离路径部分，只保留 origin。
  if (api === 'mistral-conversations' && baseUrl) {
    try {
      const u = new URL(baseUrl);
      u.pathname = '';
      u.search = '';
      u.hash = '';
      baseUrl = u.toString().replace(/\/+$/, '');
    } catch { /* 保持原值 */ }
  }
  return {
    id: info.modelId,
    name: info.name ?? info.modelId,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  } as Model<any>;
}
