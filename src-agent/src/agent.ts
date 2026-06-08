import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { BridgeClient } from './bridge.js';
import { createCustomTools } from './tools/mod.js';
import { buildSystemPrompt } from './prompts/system.js';
import type { AgentContext } from './protocol.js';

export async function createSheetAgent(bridge: BridgeClient) {
  const customTools = createCustomTools(bridge);

  let defaultModel: {
    providerType: string;
    modelId: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
  } | null = null;
  try {
    defaultModel = await bridge.getDefaultModel();
  } catch {
    // no model config yet, agent will start with no model
  }

  // 创建内存中的 AuthStorage 和 ModelRegistry，确保用户 API key 能被正确解析
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  let model: any = undefined;
  if (defaultModel) {
    try {
      const { getModel, getProviders } = await import('@earendil-works/pi-ai');

      // 尝试通过 pi-ai 内置 provider + modelId 查找模型
      // providerType 是 api 类型（如 'openai-completions'），不是 provider 名称（如 'openai'）
      // 需要遍历内置 provider 列表寻找匹配的模型
      let builtIn: any = undefined;
      const providers = getProviders();
      for (const provider of providers) {
        try {
          const found = getModel(provider as any, defaultModel.modelId as any);
          if (found) {
            builtIn = found;
            break;
          }
        } catch {
          // continue searching
        }
      }

      if (builtIn) {
        // 内置模型：使用它，通过 setRuntimeApiKey 注册 API key
        // 关键：必须使用 builtIn.provider（如 'openai'）而非 providerType（如 'openai-completions'）
        // 因为 SDK 内部按 model.provider 查找 auth
        model = defaultModel.baseUrl
          ? { ...builtIn, baseUrl: defaultModel.baseUrl }
          : builtIn;
        if (defaultModel.apiKey) {
          authStorage.setRuntimeApiKey(builtIn.provider, defaultModel.apiKey);
        }
      } else {
        // 自定义模型不在 pi-ai 内置列表中
        // 使用 providerType 作为 provider name，与 registerProvider 的 key 保持一致
        const providerName = defaultModel.providerType;
        model = {
          id: defaultModel.modelId,
          name: defaultModel.name ?? defaultModel.modelId,
          api: defaultModel.providerType,
          provider: providerName,
          baseUrl: defaultModel.baseUrl || '',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        };
        if (defaultModel.apiKey) {
          modelRegistry.registerProvider(providerName, {
            apiKey: defaultModel.apiKey,
            baseUrl: defaultModel.baseUrl,
            models: [{
              id: defaultModel.modelId,
              name: defaultModel.name ?? defaultModel.modelId,
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            }],
          });
        }
      }
    } catch {
      // model resolution failed, user needs to configure
    }
  }

  const systemPrompt = buildSystemPrompt();

  const { session } = await createAgentSession({
    model,
    tools: ['read', 'bash', 'edit', 'write'],
    customTools,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd: process.cwd(),
  });

  return session;
}
