import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { BridgeClient } from './bridge.js';
import { createCustomTools } from './tools/mod.js';
import { buildSystemPrompt } from './prompts/system.js';
import type { AgentContext } from './protocol.js';

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  'openai-completions': 'OPENAI_API_KEY',
  'openai-responses': 'OPENAI_API_KEY',
  'anthropic-messages': 'ANTHROPIC_API_KEY',
};

function applyApiKeyEnv(providerType: string, apiKey: string | undefined): void {
  if (!apiKey) return;
  const envKey = PROVIDER_API_KEY_ENV[providerType];
  if (envKey && !process.env[envKey]) {
    process.env[envKey] = apiKey;
  }
}

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

  let model: any = undefined;
  if (defaultModel) {
    try {
      const { getModel } = await import('@earendil-works/pi-ai');
      model = getModel(defaultModel.providerType as any, defaultModel.modelId as any);

      if (model) {
        if (defaultModel.baseUrl) {
          model = { ...model, baseUrl: defaultModel.baseUrl };
        }
        applyApiKeyEnv(defaultModel.providerType, defaultModel.apiKey);
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
    sessionManager: SessionManager.inMemory(),
    cwd: process.cwd(),
  });

  return session;
}
