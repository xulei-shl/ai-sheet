/**
 * openaiClient.ts — 极简 OpenAI Completions API 封装
 *
 * 只做一件事：调用 /v1/chat/completions
 * 兼容所有 OpenAI-compatible 端点（DeepSeek、Ollama 等）
 *
 * 通过 Tauri command (Rust reqwest) 代理请求，绕过浏览器 CORS 限制
 */

import { invoke } from '@tauri-apps/api/core';

export interface OpenAIChatParams {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  signal?: AbortSignal;
}

export async function callOpenAIChat(params: OpenAIChatParams): Promise<string> {
  // 如果已中止，直接抛出
  if (params.signal?.aborted) {
    throw new Error('已中止');
  }

  const result = await invoke<{
    success: boolean;
    content?: string;
    error?: string;
  }>('llm_chat_completions', {
    req: {
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      modelId: params.modelId,
      messages: params.messages,
      temperature: params.temperature,
    },
  });

  if (!result.success) {
    throw new Error(result.error ?? '未知错误');
  }

  return result.content ?? '';
}
