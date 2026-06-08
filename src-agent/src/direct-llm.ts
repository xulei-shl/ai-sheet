import { stream } from '@earendil-works/pi-ai';
import type { BridgeClient } from './bridge.js';
import type { SidecarCommand } from './protocol.js';
import type { SidecarEvent } from './protocol.js';
import { buildModel } from './provider-map.js';
import { setUseProxy } from './proxy-state.js';

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

  let modelInfo: { providerType: string; modelId: string; name?: string; apiKey?: string; baseUrl?: string; useProxy?: boolean };
  try {
    modelInfo = await bridge.getDefaultModel();
  } catch (e) {
    emit({ type: 'agent_error', id: command.id, message: `获取模型失败: ${(e as Error).message}` });
    return;
  }

  if (!modelInfo.apiKey) {
    emit({ type: 'agent_error', id: command.id, message: '当前未配置默认模型或缺少 API Key' });
    return;
  }

  // 同步代理状态：根据模型的 useProxy 设置决定 fetch 路由
  setUseProxy(modelInfo.useProxy ?? true);

  // 使用 provider-map 正确拆分 provider 和 api
  const model = buildModel(modelInfo);

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
      { temperature: 0.3, signal: controller.signal, apiKey: modelInfo.apiKey },
    );

    let llmError: string | null = null;

    for await (const ev of eventStream as AsyncIterable<any>) {
      if (controller.signal.aborted) break;

      if (ev.type === 'text_delta') {
        // pi-ai 的文本增量事件，delta 字段包含增量文本
        const delta: string = ev.delta ?? '';
        if (delta) {
          emit({ type: 'agent_delta', id: command.id, delta });
        }
      } else if (ev.type === 'error') {
        // pi-ai 的错误事件，error 是 AssistantMessage，含 errorMessage 字段
        llmError = ev.error?.errorMessage ?? 'LLM 返回错误';
        break;
      }
      // 其他事件类型（start, text_start, text_end, thinking_*, toolcall_*, done）忽略
    }

    if (llmError) {
      emit({ type: 'agent_error', id: command.id, message: llmError });
    } else {
      emit({ type: 'agent_done', id: command.id });
    }
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
