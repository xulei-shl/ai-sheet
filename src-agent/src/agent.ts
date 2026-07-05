import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, SettingsManager, DefaultResourceLoader, getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BridgeClient } from './bridge.js';
import { createCustomTools } from './tools/mod.js';
import { buildModel } from './provider-map.js';
import { setUseProxy } from './proxy-state.js';

export interface SheetAgentContext {
  session: AgentSession;
  modelRegistry: ModelRegistry;
  authStorage: AuthStorage;
  contextWindow: number;
}

// initialCwd 在 sidecar 启动时固定为 --db-dir (app_data_dir)，永不被 set_cwd 更新。
// DefaultResourceLoader 的 cwd 仅用于 .pi/ 资源扫描（AGENTS.md / SYSTEM.md / skills），
// 与运行时 currentCwd（工具执行路径）完全解耦。
export async function createSheetAgent(bridge: BridgeClient, initialCwd: string, sessionDir?: string): Promise<SheetAgentContext> {
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

  // 从 .pi/ 目录显式加载 AGENTS.md 和 SYSTEM.md（与动态 cwd 解耦）
  const piDir = join(initialCwd, '.pi');
  const agentsMdPath = join(piDir, 'AGENTS.md');
  const systemMdPath = join(piDir, 'SYSTEM.md');

  // 构造 loader，cwd 固定为 initialCwd（app_data_dir），与运行时 currentCwd 解耦。
  // cwd 仅用于 .pi/ 资源扫描路径解析；工具执行路径由 main.ts 的 currentCwd 接管。
  const loader = new DefaultResourceLoader({
    cwd: initialCwd,
    agentDir: getAgentDir(),
    systemPromptOverride: () => {
      try {
        return readFileSync(systemMdPath, 'utf-8');
      } catch {
        return undefined;
      }
    },
    agentsFilesOverride: (current) => {
      try {
        const content = readFileSync(agentsMdPath, 'utf-8');
        return {
          agentsFiles: [...current.agentsFiles, { path: agentsMdPath, content }],
        };
      } catch {
        return current;
      }
    },
  });
  // reload() 只在此处调用一次，后续 set_cwd 不会触发重新加载，确保 skills 缓存稳定
  await loader.reload();

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
    sessionManager: sessionDir ? SessionManager.create(initialCwd, sessionDir) : SessionManager.inMemory(),
    cwd: initialCwd,
    resourceLoader: loader,
  });

  log(`session created, cwd=${initialCwd}, httpIdleTimeoutMs=${settingsManager.getHttpIdleTimeoutMs()}, retry.maxRetries=${settingsManager.getRetrySettings().maxRetries}`);

  return { session, modelRegistry, authStorage, contextWindow: model?.contextWindow ?? 0 };
}
