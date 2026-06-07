import { defineTool, type ExtensionContext, type AgentToolResult, type AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { BridgeClient } from '../bridge.js';

export function excelTools(bridge: BridgeClient) {
  return [
    defineTool({
      name: 'read_excel',
      label: '读取 Excel',
      description: '读取 Excel 文件信息、Sheet 列表、列数据或样本数据',
      promptSnippet: '读取 Excel 文件信息、Sheet 列表、列数据或样本数据',
      promptGuidelines: [
        '使用 read_excel 查看 Excel 文件中的数据结构',
        '在生成公式或代码前先检查列名和样本数据',
      ],
      parameters: Type.Object({
        action: Type.Union([Type.Literal('info'), Type.Literal('columns'), Type.Literal('sample')]),
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.Optional(Type.String({ description: 'Sheet 名称' })),
        columns: Type.Optional(Type.Array(Type.String(), { description: '要读取的列名' })),
        rows: Type.Optional(Type.Number({ description: '样本行数' })),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        const result = await bridge.post(`/api/excel/${params.action}`, params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    }),

    defineTool({
      name: 'write_excel',
      label: '写入 Excel',
      description: '将处理结果写入 Excel 文件的指定列',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        column: Type.String({ description: '目标列名' }),
        results: Type.Array(Type.Object({
          row: Type.Number(),
          value: Type.String(),
        }), { description: '写入数据' }),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        await bridge.post('/api/excel/write', params);
        return {
          content: [{ type: 'text', text: `已写入 ${params.results.length} 条结果到 ${params.sheet} 的 ${params.column} 列` }],
          details: { writtenCount: params.results.length },
        };
      },
    }),

    defineTool({
      name: 'apply_formula',
      label: '应用公式',
      description: '将 Excel 公式应用到指定列的所有行',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        column: Type.String({ description: '目标列名' }),
        formula: Type.String({ description: 'Excel 公式' }),
      }),
      execute: async (_toolCallId: string, params, _signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<unknown> | undefined, _ctx: ExtensionContext): Promise<AgentToolResult<unknown>> => {
        await bridge.post('/api/excel/apply-formula', params);
        return {
          content: [{ type: 'text', text: `公式 ${params.formula} 已应用到 ${params.sheet} 的 ${params.column} 列` }],
          details: { applied: true },
        };
      },
    }),
  ];
}
