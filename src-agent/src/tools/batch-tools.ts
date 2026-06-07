import { defineTool, type ExtensionContext, type AgentToolResult, type AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { BridgeClient } from '../bridge.js';

export function batchTools(bridge: BridgeClient) {
  return [
    defineTool({
      name: 'start_batch',
      label: '启动批量处理',
      description: '对 Excel 数据批量调用 LLM 处理，逐行执行提示词并写入结果',
      promptSnippet: '对 Excel 数据批量调用 LLM 处理',
      promptGuidelines: [
        '使用 start_batch 对 Excel 数据逐行调用 LLM 处理',
        '建议先在小样本上验证提示词效果',
        '可以同时保存提示词供后续复用',
      ],
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        inputColumns: Type.Array(Type.String(), { description: '输入列名列表' }),
        outputColumn: Type.String({ description: '输出列名' }),
        prompt: Type.String({ description: '处理提示词，可用 {列名} 引用当前行数据' }),
        savePrompt: Type.Optional(Type.Boolean({ description: '是否保存提示词供复用' })),
        promptName: Type.Optional(Type.String({ description: '保存时的提示词名称' })),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        if (params.savePrompt && params.promptName) {
          await bridge.post('/api/prompts', {
            name: params.promptName,
            content: params.prompt,
            category: 'batch',
          });
        }

        const result = await bridge.post<{ batchId: string }>('/api/batch/start', {
          filePath: params.path,
          sheet: params.sheet,
          inputColumns: params.inputColumns,
          outputColumn: params.outputColumn,
          prompt: params.prompt,
        });

        return {
          content: [{ type: 'text', text: `批量处理已启动，ID: ${result.batchId}` }],
          details: result,
        };
      },
    }),

    defineTool({
      name: 'pause_batch',
      label: '暂停批量处理',
      description: '暂停正在运行的批量处理任务',
      parameters: Type.Object({
        batchId: Type.String({ description: '批量处理 ID' }),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        await bridge.post('/api/batch/pause', { batchId: params.batchId });
        return {
          content: [{ type: 'text', text: `批量处理 ${params.batchId} 已暂停` }],
          details: { paused: true },
        };
      },
    }),

    defineTool({
      name: 'get_batch_status',
      label: '查询批量处理状态',
      description: '查询批量处理任务的当前进度和状态',
      parameters: Type.Object({
        batchId: Type.String({ description: '批量处理 ID' }),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        const status = await bridge.post('/api/batch/status', { batchId: params.batchId });
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          details: status,
        };
      },
    }),
  ];
}
