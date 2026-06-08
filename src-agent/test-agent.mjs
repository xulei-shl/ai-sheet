import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';

const API_KEY = 'UC7fcr74stXDovzuJAvgu7q2SJxhRhA7';
const MODEL_ID = 'mistral-large-2512';
const BASE_URL = 'https://api.mistral.ai/v1';

async function main() {
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const providerName = 'openai-completions';

  const model = {
    id: MODEL_ID,
    name: MODEL_ID,
    api: providerName,
    provider: providerName,
    baseUrl: BASE_URL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  modelRegistry.registerProvider(providerName, {
    api: providerName,
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    models: [{
      id: MODEL_ID,
      name: MODEL_ID,
      api: providerName,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
  });

  // Create with shorter timeout
  const sm = SettingsManager.create(process.cwd());
  sm.setHttpIdleTimeoutMs(30000);

  const { session } = await createAgentSession({
    model,
    tools: [],
    authStorage,
    modelRegistry,
    settingsManager: sm,
    sessionManager: SessionManager.inMemory(),
    cwd: process.cwd(),
  });

  console.log('Session created. Sending prompt...\n');

  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event.type);
    if (event.type === 'message_update') {
      const me = event.assistantMessageEvent;
      if (me?.type === 'text_delta' && me.delta) {
        process.stdout.write(me.delta);
      }
    }
    if (event.type === 'message_end') {
      const msg = event.message;
      console.log('\n[message_end] role:', msg?.role, 'stopReason:', msg?.stopReason, 'errorMessage:', msg?.errorMessage?.slice(0,100));
    }
    if (event.type === 'agent_end') {
      console.log('\n[agent_end] willRetry:', event.willRetry);
    }
  });

  try {
    await session.prompt('Say hello in one short sentence.');
    console.log('\n\n--- prompt() resolved ---');
    console.log('Events received:', events.join(', '));
  } catch (err) {
    console.error('\n\n--- prompt() threw ---');
    console.error(err);
  }

  unsubscribe();
}

main();
