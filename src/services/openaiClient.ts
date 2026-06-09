/**
 * openaiClient.ts — 极简 OpenAI Completions API 封装
 *
 * 只做一件事：调用 /v1/chat/completions
 * 兼容所有 OpenAI-compatible 端点（DeepSeek、Ollama 等）
 */

export interface OpenAIChatParams {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  signal?: AbortSignal;
}

export async function callOpenAIChat(params: OpenAIChatParams): Promise<string> {
  const baseUrl = params.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  // 合并超时信号和用户中止信号
  const timeoutSignal = AbortSignal.timeout(120_000);
  const signals = [timeoutSignal, params.signal].filter(Boolean) as AbortSignal[];
  const combinedSignal = signals.length > 1
    ? AbortSignal.any(signals)
    : signals[0] ?? undefined;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.modelId,
      messages: params.messages,
      temperature: params.temperature,
    }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`API Error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
