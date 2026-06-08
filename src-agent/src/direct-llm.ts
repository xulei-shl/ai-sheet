import { stream, getModel, getProviders } from '@earendil-works/pi-ai';
import type { BridgeClient } from './bridge.js';
import type { SidecarCommand } from './protocol.js';
import type { SidecarEvent } from './protocol.js';

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
  let resolvedApiKey: string | undefined;
  try {
    // providerType 是 api 类型（如 'openai-completions'），不是 provider 名称（如 'openai'）
    // 遍历内置 provider 列表寻找匹配的模型
    let builtIn: any = undefined;
    const providers = getProviders();
    for (const provider of providers) {
      try {
        const found = getModel(provider as any, modelInfo.modelId as any);
        if (found) {
          builtIn = found;
          break;
        }
      } catch {
        // continue searching
      }
    }

    if (builtIn) {
      model = modelInfo.baseUrl ? { ...builtIn, baseUrl: modelInfo.baseUrl } : builtIn;
    } else {
      // 自定义模型不在 pi-ai 内置列表中 → 手动构造 Model<Api> 对象
      model = {
        id: modelInfo.modelId,
        name: (modelInfo as any).name ?? modelInfo.modelId,
        api: modelInfo.providerType,
        provider: modelInfo.providerType,
        baseUrl: modelInfo.baseUrl || '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      };
    }
    resolvedApiKey = modelInfo.apiKey;
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
      { temperature: 0.3, signal: controller.signal, apiKey: resolvedApiKey },
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
