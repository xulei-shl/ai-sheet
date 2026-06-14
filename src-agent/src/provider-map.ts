/**
 * provider-map.ts — providerType → (provider, api) 映射 + contextWindow 查找
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

// ─── contextWindow 查找 ────────────────────────────────────────────

/** 各 provider 默认 context window（特定模型未匹配时使用） */
const PROVIDER_DEFAULT_WINDOW: Record<string, number> = {
  'openai-completions':     128_000,
  'openai-responses':       128_000,
  'anthropic-messages':     200_000,
  'deepseek':               128_000,
  'mistral-conversations':  128_000,
  'google-generative-ai':   1_000_000,
  'google-vertex':          1_000_000,
  'bedrock-converse-stream':128_000,
  'azure-openai-responses': 128_000,
};

/** 已知模型 ID 前缀 → context window（优先级高于 provider 默认） */
const MODEL_WINDOW: Array<[prefix: string, window: number]> = [
  // ── OpenAI ──
  ['o1',              200_000],
  ['o3',              200_000],
  ['gpt-4o',          128_000],
  ['gpt-4-turbo',     128_000],
  ['gpt-4-32k',        32_000],
  ['gpt-4',             8_000],
  ['gpt-3.5-turbo',    16_000],
  // ── Anthropic ── (所有 Claude 均为 200K)
  ['claude',           200_000],
  // ── DeepSeek ──
  ['deepseek',         128_000],
  // ── Google ──
  ['gemini-2.5-pro', 1_000_000],
  ['gemini-2.0-pro', 2_000_000],
  ['gemini-2.0-flash',1_000_000],
  ['gemini-1.5-pro',  2_000_000],
  ['gemini-1.5-flash',1_000_000],
  ['gemini',           128_000],
  // ── Mistral ──
  ['mistral-large',    128_000],
  ['mistral-small',     32_000],
  ['mistral-medium',    32_000],
  ['mistral',           128_000],
  // ── Amazon Bedrock ──
  ['claude',           200_000],
];

/**
 * 根据 providerType + modelId 解析 contextWindow
 *
 * 优先级：modelId 前缀匹配 > provider 默认 > 128K
 */
function resolveContextWindow(providerType: string, modelId: string): number {
  const idLower = modelId.toLowerCase();
  for (const [prefix, window] of MODEL_WINDOW) {
    if (idLower.startsWith(prefix)) return window;
  }
  return PROVIDER_DEFAULT_WINDOW[providerType] ?? 128_000;
}

// ─── provider/api 拆分 ────────────────────────────────────────────

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

  for (const suffix of KNOWN_API_SUFFIXES) {
    if (providerType.endsWith('-' + suffix)) {
      const provider = providerType.slice(0, providerType.length - suffix.length - 1);
      if (provider) return { provider, api: suffix, defaultBaseUrl: '' };
    }
  }

  return { provider: providerType, api: providerType, defaultBaseUrl: '' };
}

// ─── 模型构建 ──────────────────────────────────────────────────────

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

  // 优先级: 显式传入 > 查找表 > provider 默认
  const contextWindow = info.contextWindow ?? resolveContextWindow(info.providerType, info.modelId);

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
