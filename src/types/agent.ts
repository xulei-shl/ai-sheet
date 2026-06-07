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

export interface AgentContext {
  currentTab: string;
  loadedFiles: string[];
  selectedColumns: string[];
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
