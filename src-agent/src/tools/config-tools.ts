import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { BridgeClient } from '../bridge.js';

export function configTools(bridge: BridgeClient) {
  return [
    defineTool({
      name: 'get_config',
      label: '获取配置',
      description: '获取当前模型配置列表和默认模型信息',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        const defaultModel = await bridge.post<{ providerType: string; modelId: string }>('/api/config/default');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ defaultModel }, null, 2) }],
          details: { defaultModel },
        };
      },
    }),

    defineTool({
      name: 'test_connection',
      label: '测试连接',
      description: '测试 API 连接是否正常',
      parameters: Type.Object({
        providerType: Type.String({ description: 'Provider 类型' }),
        modelId: Type.String({ description: '模型 ID' }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const result = await bridge.post<{ success?: boolean; error?: string }>('/api/config/test', params);
        return {
          content: [{ type: 'text' as const, text: result.success ? '连接成功' : `连接失败: ${result.error ?? '未知错误'}` }],
          details: result,
        };
      },
    }),
  ];
}
