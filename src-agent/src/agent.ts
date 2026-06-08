import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { BridgeClient } from './bridge.js';
import { createCustomTools } from './tools/mod.js';
import { buildSystemPrompt } from './prompts/system.js';
import { buildModel } from './provider-map.js';
import { setUseProxy } from './proxy-state.js';
import type { AgentContext } from './protocol.js';

export async function createSheetAgent(bridge: BridgeClient) {
  const customTools = createCustomTools(bridge);

  let defaultModel: {
    providerType: string;
    modelId: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    useProxy?: boolean;
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

  let model: ReturnType<typeof buildModel> | undefined = undefined;
  if (defaultModel) {
    log(`defaultModel: providerType=${defaultModel.providerType}, modelId=${defaultModel.modelId}, baseUrl=${defaultModel.baseUrl}, hasApiKey=${!!defaultModel.apiKey}`);

    // 同步代理状态：根据模型的 useProxy 设置决定 fetch 路由
    setUseProxy(defaultModel.useProxy ?? true);
    log(`proxy state: useProxy=${defaultModel.useProxy ?? true}`);

    // 使用 provider-map 正确拆分 provider 和 api
    model = buildModel(defaultModel);
    log(`resolved model: provider=${model.provider}, api=${model.api}`);

    // 通过 registerProvider 注册 API key（使用正确的 provider 名）
    if (defaultModel.apiKey) {
      modelRegistry.registerProvider(model.provider, {
        api: model.api,
        apiKey: defaultModel.apiKey,
        baseUrl: defaultModel.baseUrl,
        models: [model],
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
