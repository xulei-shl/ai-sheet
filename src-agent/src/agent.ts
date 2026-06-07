import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { BridgeClient } from './bridge.js';
import { createCustomTools } from './tools/mod.js';
import { buildSystemPrompt } from './prompts/system.js';
import type { AgentContext } from './protocol.js';

export async function createSheetAgent(bridge: BridgeClient) {
  const customTools = createCustomTools(bridge);

  let defaultModel: { providerType: string; modelId: string } | null = null;
  try {
    defaultModel = await bridge.getDefaultModel();
  } catch {
    // no model config yet, agent will start with no model
  }

  let model = undefined;
  if (defaultModel) {
    try {
      const { getModel } = await import('@earendil-works/pi-ai');
      model = getModel(defaultModel.providerType as any, defaultModel.modelId as any);
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
