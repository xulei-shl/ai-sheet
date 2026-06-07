import { stream, getModel } from '@earendil-works/pi-ai';
import type { BridgeClient } from './bridge.js';
import type { SidecarCommand } from './protocol.js';
import type { SidecarEvent } from './protocol.js';

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

const SYSTEM_PROMPT =
  '你是一名 AI 助手。基于用户提供的 Excel 上下文（文件、Sheet、列名、样例数据），' +
  '按用户提示词模板的指示，生成精准的回答。只输出模板要求的内容。';

// 进程级单例：startDirectLlm 替换它；stop/abort 触发它的 abort
let currentAbort: AbortController | null = null;

export function abortDirectLlm(): void {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
}

export function isDirectLlmStreaming(): boolean {
  return currentAbort !== null;
}

export async function runDirectLlmStream(
  bridge: BridgeClient,
  command: Extract<SidecarCommand, { type: 'direct_llm_message' }>,
  emit: (event: SidecarEvent) => void,
): Promise<void> {
  if (currentAbort) {
    emit({ type: 'agent_error', id: command.id, message: '已有 direct LLM 在进行中' });
    return;
  }

  let modelInfo: { providerType: string; modelId: string; apiKey?: string; baseUrl?: string };
  try {
    modelInfo = await bridge.getDefaultModel();
  } catch (e) {
    emit({ type: 'agent_error', id: command.id, message: `获取模型失败: ${(e as Error).message}` });
    return;
  }

  let model: any;
  try {
    model = getModel(modelInfo.providerType as any, modelInfo.modelId as any);
    if (model && modelInfo.baseUrl) {
      model = { ...model, baseUrl: modelInfo.baseUrl };
    }
    applyApiKeyEnv(modelInfo.providerType, modelInfo.apiKey);
  } catch {
    emit({ type: 'agent_error', id: command.id, message: '模型解析失败，请到配置页检查' });
    return;
  }

  if (!model) {
    emit({ type: 'agent_error', id: command.id, message: '当前未配置默认模型' });
    return;
  }

  const controller = new AbortController();
  currentAbort = controller;

  try {
    const eventStream = stream(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: command.content }],
            timestamp: Date.now(),
          },
        ],
      },
      { temperature: 0.3, signal: controller.signal },
    );

    for await (const ev of eventStream as AsyncIterable<any>) {
      if (controller.signal.aborted) break;
      const delta = ev?.delta ?? ev?.text ?? '';
      if (delta) {
        emit({ type: 'agent_delta', id: command.id, delta });
      }
    }
    emit({ type: 'agent_done', id: command.id });
  } catch (err) {
    if (controller.signal.aborted) {
      emit({ type: 'agent_done', id: command.id });
    } else {
      emit({ type: 'agent_error', id: command.id, message: (err as Error).message });
    }
  } finally {
    if (currentAbort === controller) currentAbort = null;
  }
}
