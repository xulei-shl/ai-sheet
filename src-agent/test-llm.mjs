import { stream } from '@earendil-works/pi-ai';

const MODEL = {
  id: 'mistral-large-2512',
  name: 'Mistral Large',
  api: 'openai-completions',
  provider: 'openai-completions',
  baseUrl: 'https://api.mistral.ai/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const API_KEY = 'UC7fcr74stXDovzuJAvgu7q2SJxhRhA7';

async function main() {
  console.log(`Testing model: ${MODEL.id}`);
  console.log(`API type: ${MODEL.api}`);
  console.log(`Base URL: ${MODEL.baseUrl}`);
  console.log(`API key set: ${!!API_KEY}\n`);

  if (!API_KEY) {
    console.error('ERROR: No API key provided. Set API_KEY in the script.');
    process.exit(1);
  }

  try {
    const eventStream = stream(
      MODEL,
      {
        systemPrompt: 'You are a helpful assistant. Reply in one short sentence.',
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'Say hello' }],
          timestamp: Date.now(),
        }],
      },
      { temperature: 0.3, apiKey: API_KEY },
    );

    let text = '';
    for await (const ev of eventStream) {
      console.log('Event type:', ev?.type, JSON.stringify(ev).slice(0, 200));
      if (ev?.type === 'text_delta' && ev?.delta) {
        text += ev.delta;
        process.stdout.write(ev.delta);
      }
      if (ev?.type === 'error') {
        console.error('\n=== LLM ERROR ===');
        console.error('stopReason:', ev?.reason);
        console.error('errorMessage:', ev?.error?.errorMessage ?? JSON.stringify(ev?.error));
        console.error(JSON.stringify(ev, null, 2));
        return;
      }
      if (ev?.type === 'done') {
        console.log('\n=== STREAM DONE ===');
        console.log('stopReason:', ev?.message?.stopReason);
        console.log('content length:', ev?.message?.content?.length);
        if (ev?.message?.errorMessage) {
          console.log('errorMessage:', ev?.message?.errorMessage);
        }
      }
    }

    console.log(`\n\nFinal output: "${text}"`);
    console.log(`Output length: ${text.length}`);
  } catch (err) {
    console.error('\n=== EXCEPTION ===');
    console.error(err);
  }
}

main();
