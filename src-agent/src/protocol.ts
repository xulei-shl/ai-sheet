export interface SetModelInfo {
  name: string;
  providerType: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  useProxy?: boolean;
}

export type SidecarCommand =
  | { id: string; type: 'ping' }
  | { id: string; type: 'user_message'; content: string }
  | { id: string; type: 'steer'; context: AgentContext }
  | { id: string; type: 'set_model'; model: SetModelInfo }
  | { id: string; type: 'set_cwd'; cwd: string }
  | { id: string; type: 'batch_start'; params: BatchParams }
  | { id: string; type: 'batch_pause'; batchId: string }
  | { id: string; type: 'batch_resume'; batchId: string }
  | { id: string; type: 'batch_stop'; batchId: string }
  | { id: string; type: 'batch_status'; batchId: string }
  | { id: string; type: 'reset' }
  | { id: string; type: 'stop' };

export interface AgentStats {
  inputTokens: number;
  outputTokens: number;
  contextUsage: number;    // 0~1 的上下文使用率
}

export type SidecarEvent =
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'agent_delta'; id: string; delta: string }
  | { type: 'agent_done'; id: string; stats?: AgentStats }
  | { type: 'agent_error'; id?: string; message: string }
  | { type: 'agent_tool_start'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'agent_tool_end'; id: string; tool: string; result: string }
  | { type: 'batch_progress'; batchId: string; current: number; total: number; speed: number }
  | { type: 'batch_row_complete'; batchId: string; row: number; result: string }
  | { type: 'batch_done'; batchId: string; stats: BatchStats }
  | { type: 'batch_error'; batchId: string; message: string }
  | { type: 'batch_paused'; batchId: string }
  | { type: 'sidecar_ready' }
  | { type: 'cwd_changed'; id: string; cwd: string }
  | { type: 'model_switch_result'; id: string; success: boolean; error?: string; modelName?: string };

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
  currentTab?: string;
  loadedFiles?: LoadedFile[];
  selectedColumns?: string[];
  sampleDataPreview?: string;
  cwd?: string;
}

export interface BatchParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  prompt: string;
  modelId?: string;
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  useProxy?: boolean;
  temperature?: number;
  savePrompt?: boolean;
  promptName?: string;
}

export interface BatchStats {
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  totalTimeMs: number;
  avgSpeed: number;
}
