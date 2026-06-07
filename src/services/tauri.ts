import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentStatus, SidecarEvent, AgentContext } from '../types/agent';
import type { ModelConfig } from '../types/config';
import type { Prompt, PromptInput } from '../types/prompt';
import type { FormulaCacheEntry } from '../types/formula';
import type {
  ColumnInfo,
  SampleData,
  ColumnData,
  WriteResult,
  ApplyFormulaRequest,
  ProcessingStatus,
} from '../types/excel';

export interface AppStatus {
  name: string;
  version: string;
}

export interface ExcelInfo {
  filePath: string;
  fileName: string;
  fileSize: number;
  sheets: { name: string; rowCount: number; columnCount: number }[];
}

// App
export function getAppStatus() {
  return invoke<AppStatus>('get_app_status');
}

// Config
export function getActiveModel() {
  return invoke<ModelConfig>('get_active_model');
}

export function getFallbackModels() {
  return invoke<ModelConfig[]>('get_fallback_models');
}

export function getUserModels() {
  return invoke<ModelConfig[]>('get_user_models');
}

export function addUserModel(model: ModelConfig) {
  return invoke<ModelConfig>('add_user_model', { model });
}

export function updateUserModel(index: number, model: ModelConfig) {
  return invoke<void>('update_user_model', { index, model });
}

export function deleteUserModel(index: number) {
  return invoke<void>('delete_user_model', { index });
}

// Formula Cache

export function getFormulaHistory() {
  return invoke<FormulaCacheEntry[]>('get_formula_history');
}

export function saveFormulaCache(
  requirement: string,
  columnsKey: string,
  formula: string,
  explanation?: string,
) {
  return invoke<number>('save_formula_cache', { requirement, columnsKey, formula, explanation });
}

export function touchFormulaCache(id: number) {
  return invoke<void>('touch_formula_cache', { id });
}

// Prompts
export function getAllPrompts() {
  return invoke<Prompt[]>('get_all_prompts');
}

export function savePrompt(input: PromptInput) {
  return invoke<Prompt>('save_prompt', { input });
}

export function updatePrompt(id: string, input: PromptInput) {
  return invoke<void>('update_prompt', { id, input });
}

export function deletePrompt(id: string) {
  return invoke<void>('delete_prompt', { id });
}

// Excel
export function getExcelInfo(path: string) {
  return invoke<ExcelInfo>('get_excel_info', { path });
}

export function getSheetNames(path: string) {
  return invoke<string[]>('get_sheet_names', { path });
}

export function getColumnNames(path: string, sheet: string) {
  return invoke<ColumnInfo[]>('get_column_names', { path, sheet });
}

export function getSampleData(path: string, sheet: string, rows?: number) {
  return invoke<SampleData>('get_sample_data', { path, sheet, rows });
}

export function getColumnData(path: string, sheet: string, columns: string[]) {
  return invoke<ColumnData>('get_column_data', { path, sheet, columns });
}

export function writeExcelResults(req: {
  path: string;
  sheet: string;
  column: string;
  results: WriteResult[];
}) {
  return invoke<void>('write_excel_results', { req });
}

export function applyExcelFormula(req: ApplyFormulaRequest) {
  return invoke<void>('apply_excel_formula', { req });
}

export function getExcelProcessingStatus(
  path: string,
  sheet: string,
  resultColumn: string
) {
  return invoke<ProcessingStatus>('get_excel_processing_status', {
    path,
    sheet,
    resultColumn,
  });
}

// Agent
export function getAgentStatus() {
  return invoke<AgentStatus>('get_agent_status');
}

export function sendAgentMessage(content: string) {
  return invoke<void>('send_agent_message', { content });
}

export function restartSidecar() {
  return invoke<void>('restart_sidecar');
}

export function steerAgent(context: AgentContext) {
  return invoke<void>('steer_agent', { context: JSON.stringify(context) });
}

export function stopAgentStream() {
  return invoke<void>('stop_agent_stream');
}

// Events
export function onAgentEvent(handler: (event: SidecarEvent) => void) {
  return listen<SidecarEvent>('agent-event', (event) => handler(event.payload));
}

export function onSidecarDead(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<{ message?: string }>('sidecar-dead', (event) => {
    handler(event.payload.message ?? 'Sidecar offline');
  });
}

export function onSidecarRestarted(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<{ message?: string }>('sidecar-restarted', (event) => {
    handler(event.payload.message ?? 'AI Agent 已重新连接');
  });
}

export function onBridgeReady(handler: (port: number) => void): Promise<UnlistenFn> {
  return listen<{ port: number }>('bridge-ready', (event) => {
    handler(event.payload.port);
  });
}

export function onNotification(handler: (data: unknown) => void): Promise<UnlistenFn> {
  return listen<unknown>('bridge-notification', (event) => {
    handler(event.payload);
  });
}
