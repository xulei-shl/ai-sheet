import { defineTool, type ExtensionContext, type AgentToolResult, type AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { BridgeClient } from '../bridge.js';

export function promptTools(bridge: BridgeClient) {
  return [
    defineTool({
      name: 'get_prompts',
      label: '获取提示词',
      description: '获取所有已保存的提示词模板列表',
      parameters: Type.Object({}),
      execute: async (_toolCallId: string, _params: Record<string, never>, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        const prompts = await bridge.get('/api/prompts');
        return {
          content: [{ type: 'text', text: JSON.stringify(prompts, null, 2) }],
          details: prompts,
        };
      },
    }),

    defineTool({
      name: 'save_prompt',
      label: '保存提示词',
      description: '将当前提示词保存到数据库，供后续复用',
      parameters: Type.Object({
        name: Type.String({ description: '提示词名称' }),
        content: Type.String({ description: '提示词内容' }),
        category: Type.Optional(Type.String({ description: '提示词分类' })),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        const result = await bridge.post('/api/prompts', params);
        return {
          content: [{ type: 'text', text: `提示词 "${params.name}" 已保存` }],
          details: result,
        };
      },
    }),
  ];
}
