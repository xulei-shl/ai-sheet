import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { BatchProgress, BatchLog, BatchStartParams, BatchStatus } from '../types/processing';

interface ProcessingStore {
  isRunning: boolean;
  batchStatus: BatchStatus | null;
  batchProgress: BatchProgress | null;
  batchLogs: BatchLog[];
  selectedPromptId: string | null;
  customPrompt: string;
  inputColumns: string[];
  outputColumn: string;
  modelParams: { modelIndex: number; temperature: number };

  setCustomPrompt: (prompt: string) => void;
  setSelectedPromptId: (id: string | null) => void;
  setInputColumns: (cols: string[]) => void;
  setOutputColumn: (col: string) => void;
  setModelParams: (params: { modelIndex?: number; temperature?: number }) => void;
  startBatch: (params: BatchStartParams) => Promise<void>;
  pauseBatch: () => Promise<void>;
  resumeBatch: () => Promise<void>;
  stopBatch: () => Promise<void>;
  reset: () => void;
  addLog: (log: BatchLog) => void;
  clearLogs: () => void;
  subscribeToEvents: () => () => void;
}

export const useProcessingStore = create<ProcessingStore>((set, get) => ({
  isRunning: false,
  batchStatus: null,
  batchProgress: null,
  batchLogs: [],
  selectedPromptId: null,
  customPrompt: '',
  inputColumns: [],
  outputColumn: '',
  modelParams: { modelIndex: 0, temperature: 0.3 },

  setCustomPrompt: (prompt) => set({ customPrompt: prompt }),
  setSelectedPromptId: (id) => set({ selectedPromptId: id }),
  setInputColumns: (cols) => set({ inputColumns: cols }),
  setOutputColumn: (col) => set({ outputColumn: col }),
  setModelParams: (params) =>
    set((state) => ({
      modelParams: { ...state.modelParams, ...params },
    })),

  startBatch: async (params) => {
    set({
      isRunning: true,
      batchProgress: { batchId: '', current: 0, total: 0, speed: 0, status: 'running' },
      batchLogs: [],
    });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_message', {
        content: JSON.stringify({
          type: 'batch_start',
          params,
        }),
      });
    } catch (e) {
      set({ isRunning: false, batchProgress: null });
      get().addLog({
        id: `error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: 0,
        content: `启动失败: ${e instanceof Error ? e.message : String(e)}`,
        level: 'error',
      });
    }
  },

  pauseBatch: async () => {
    set((state) => ({
      batchProgress: state.batchProgress ? { ...state.batchProgress, status: 'paused' } : null,
    }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_message', {
        content: JSON.stringify({ type: 'batch_pause' }),
      });
    } catch {}
  },

  resumeBatch: async () => {
    set((state) => ({
      batchProgress: state.batchProgress ? { ...state.batchProgress, status: 'running' } : null,
    }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_message', {
        content: JSON.stringify({ type: 'batch_resume' }),
      });
    } catch {}
  },

  stopBatch: async () => {
    set({ isRunning: false, batchProgress: null });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_agent_message', {
        content: JSON.stringify({ type: 'batch_stop' }),
      });
    } catch {}
  },

  reset: () => {
    set({
      isRunning: false,
      batchStatus: null,
      batchProgress: null,
      batchLogs: [],
      inputColumns: [],
      outputColumn: '',
    });
  },

  addLog: (log) =>
    set((state) => ({ batchLogs: [...state.batchLogs, log] })),

  clearLogs: () => set({ batchLogs: [] }),

  subscribeToEvents: () => {
    const unlisteners: (() => void)[] = [];

    const unsub1 = listen<{
      batchId?: string;
      current?: number;
      total?: number;
      speed?: number;
      status?: string;
    }>('batch-progress', (event) => {
      const p = event.payload;
      if (p.current !== undefined && p.total !== undefined) {
        set({
          batchProgress: {
            batchId: p.batchId ?? '',
            current: p.current,
            total: p.total,
            speed: p.speed ?? 0,
            status: (p.status as BatchProgress['status']) ?? 'running',
          },
        });
      }
    }).then((fn) => unlisteners.push(fn));

    const unsub2 = listen<{
      batchId?: string;
      row?: number;
      result?: string;
    }>('batch-row-complete', (event) => {
      const p = event.payload;
      if (p.row !== undefined) {
        get().addLog({
          id: `row-${p.row}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          row: p.row,
          content: p.result ?? '处理完成',
          level: 'success',
        });
      }
    }).then((fn) => unlisteners.push(fn));

    const unsub3 = listen<{ batchId?: string; stats?: Record<string, unknown> }>(
      'batch-done',
      (event) => {
        set((state) => ({
          isRunning: false,
          batchProgress: state.batchProgress
            ? { ...state.batchProgress, status: 'completed' }
            : null,
        }));
        get().addLog({
          id: `done-${Date.now()}`,
          timestamp: new Date().toISOString(),
          row: -1,
          content: `批量处理完成${event.payload.stats ? JSON.stringify(event.payload.stats) : ''}`,
          level: 'success',
        });
      },
    ).then((fn) => unlisteners.push(fn));

    const unsub4 = listen<{ batchId?: string; message?: string }>(
      'batch-error',
      (event) => {
        set({ isRunning: false });
        get().addLog({
          id: `batch-err-${Date.now()}`,
          timestamp: new Date().toISOString(),
          row: -1,
          content: event.payload.message ?? '处理出错',
          level: 'error',
        });
      },
    ).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  },
}));
