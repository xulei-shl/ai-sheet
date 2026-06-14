/**
 * provider-map.ts — providerType → (provider, api) 映射
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

const KNOWN_API_SUFFIXES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'mistral-conversations',
  'google-generative-ai',
  'bedrock-converse-stream',
  'azure-openai-responses',
];

export function resolveProviderApi(providerType: string): { provider: string; api: string; defaultBaseUrl: string } {
  const mapped = PROVIDER_TYPE_MAP[providerType];
  if (mapped) return { provider: mapped.provider, api: mapped.api, defaultBaseUrl: mapped.baseUrl };

  for (const suffix of KNOWN_API_SUFFIXES) {
    if (providerType.endsWith('-' + suffix)) {
      const provider = providerType.slice(0, providerType.length - suffix.length - 1);
      if (provider) return { provider, api: suffix, defaultBaseUrl: '' };
    }
  }

  return { provider: providerType, api: providerType, defaultBaseUrl: '' };
}

export function buildModel(info: {
  providerType: string;
  modelId: string;
  name?: string;
  baseUrl?: string;
  contextWindow?: number | null;
}): Model<any> {
  const { provider, api, defaultBaseUrl } = resolveProviderApi(info.providerType);
  let baseUrl = info.baseUrl || defaultBaseUrl || '';

  if (api === 'mistral-conversations' && baseUrl) {
    try {
      const u = new URL(baseUrl);
      u.pathname = '';
      u.search = '';
      u.hash = '';
      baseUrl = u.toString().replace(/\/+$/, '');
    } catch { /* 保持原值 */ }
  }

  const contextWindow = info.contextWindow ?? 128_000;

  return {
    id: info.modelId,
    name: info.name ?? info.modelId,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(contextWindow, 16_384),
  } as Model<any>;
}
