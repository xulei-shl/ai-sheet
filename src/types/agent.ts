export interface AgentStatus {
  ready: boolean;
  isStreaming: boolean;
  lastHeartbeatAgeSecs: number | null;
  message: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;        // 标记为错误消息
  requestId?: string;       // 关联 direct LLM 流或 agent 流
  fullContent?: string;     // 实际发送给 LLM 的完整 prompt（仅 user 可选）
  displayContent?: string;  // UI 显示用摘要；缺省回退到 content
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
}

export interface ToolResult {
  tool: string;
  result: string;
  success: boolean;
}

export interface LoadedColumn {
  name: string;
  letter: string;
}

export interface LoadedSheet {
  sheetName: string;
  columns: LoadedColumn[];
}

export interface LoadedFile {
  name: string;
  path: string;
  sheets: LoadedSheet[];
}

export interface AgentContext {
  loadedFiles?: LoadedFile[];
  sampleDataPreview?: string;
}

export type SidecarEvent =
  | { type: 'agent_delta'; id: string; delta: string }
  | { type: 'agent_done'; id: string }
  | { type: 'agent_error'; id?: string; message: string }
  | { type: 'agent_tool_start'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'agent_tool_end'; id: string; tool: string; result: string }
  | { type: 'batch_progress'; batchId: string; current: number; total: number; speed: number }
  | { type: 'batch_row_complete'; batchId: string; row: number; result: string }
  | { type: 'batch_done'; batchId: string; stats: Record<string, unknown> }
  | { type: 'batch_error'; batchId: string; message: string };
