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
  | { id: string; type: 'direct_llm_message'; action: string; content: string; context: DirectLlmContext }
  | { id: string; type: 'steer'; context: AgentContext }
  | { id: string; type: 'set_model'; model: SetModelInfo }
  | { id: string; type: 'batch_start'; params: BatchParams }
  | { id: string; type: 'batch_pause'; batchId: string }
  | { id: string; type: 'batch_resume'; batchId: string }
  | { id: string; type: 'batch_stop'; batchId: string }
  | { id: string; type: 'batch_status'; batchId: string }
  | { id: string; type: 'reset' }
  | { id: string; type: 'stop' };

export interface DirectLlmSheet {
  sheet: string;
  columns: string[];
}

export interface DirectLlmContext {
  fileName: string;
  sheets: DirectLlmSheet[];
  samplePreview?: string;
}

/**
 * `agent_delta` / `agent_done` / `agent_error` 的 `id` 字段可携带前缀
 * 区分流来源：'msg-<millis>' 来自 AgentSession（Agent 流），
 * 'direct-<rand>' 来自直接 LLM 调用（Direct LLM 流）。前端 store
 * 按前缀路由到对应的 streaming state，避免两类流互串。
 */
export type SidecarEvent =
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'agent_delta'; id: string; delta: string }
  | { type: 'agent_done'; id: string }
  | { type: 'agent_error'; id?: string; message: string }
  | { type: 'agent_tool_start'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'agent_tool_end'; id: string; tool: string; result: string }
  | { type: 'batch_progress'; batchId: string; current: number; total: number; speed: number }
  | { type: 'batch_row_complete'; batchId: string; row: number; result: string }
  | { type: 'batch_done'; batchId: string; stats: BatchStats }
  | { type: 'batch_error'; batchId: string; message: string }
  | { type: 'batch_paused'; batchId: string }
  | { type: 'sidecar_ready' }
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
