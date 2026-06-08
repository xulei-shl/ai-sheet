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

  // 创建内存中的 AuthStorage 和 ModelRegistry
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  let model: any = undefined;
  if (defaultModel) {
    // 完全按用户配置的 providerType 构造模型，不搜索内置模型
    // providerType 就是 API 类型（如 'openai-completions', 'anthropic-messages', 'mistral-conversations'）
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
    } as any;

    // 通过 registerProvider 注册 API key
    if (defaultModel.apiKey) {
      modelRegistry.registerProvider(providerName, {
        api: defaultModel.providerType,
        apiKey: defaultModel.apiKey,
        baseUrl: defaultModel.baseUrl,
        models: [{
          id: defaultModel.modelId,
          name: defaultModel.name ?? defaultModel.modelId,
          api: defaultModel.providerType,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        }],
      } as any);
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
