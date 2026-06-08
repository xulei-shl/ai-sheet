import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
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

  const log = (msg: string) => process.stderr.write(`[agent] ${msg}\n`);

  let model: any = undefined;
  if (defaultModel) {
    log(`defaultModel: providerType=${defaultModel.providerType}, modelId=${defaultModel.modelId}, baseUrl=${defaultModel.baseUrl}, hasApiKey=${!!defaultModel.apiKey}`);
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

  // 设置 60 秒超时并禁用自动重试，避免请求挂起过久或被重试淹没
  const settingsManager = SettingsManager.inMemory({
    httpIdleTimeoutMs: 60000,
    retry: { maxRetries: 0 },
  });

  const { session } = await createAgentSession({
    model,
    tools: ['read', 'bash', 'edit', 'write'],
    customTools,
    authStorage,
    modelRegistry,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    cwd: process.cwd(),
  });

  log(`session created, httpIdleTimeoutMs=${settingsManager.getHttpIdleTimeoutMs()}, retry.maxRetries=${settingsManager.getRetrySettings().maxRetries}`);

  return session;
}
