import { create } from 'zustand';
import type { BatchProgress, BatchLog, BatchStartParams } from '../types/processing';
import type { ModelConfig } from '../types/config';
import { runLLMBatch, PauseController } from '../services/llmBatchService';

interface ProcessingStore {
  isRunning: boolean;
  batchProgress: BatchProgress | null;
  batchLogs: BatchLog[];
  selectedPromptId: string | null;
  customPrompt: string;
  inputColumns: string[];
  outputColumn: string;
  modelParams: { temperature: number };
  // 新增状态
  selectedModel: ModelConfig | null;
  batchSize: number;
  errorColumn: string;

  setCustomPrompt: (prompt: string) => void;
  setSelectedPromptId: (id: string | null) => void;
  setInputColumns: (cols: string[]) => void;
  setOutputColumn: (col: string) => void;
  setModelParams: (params: { temperature?: number }) => void;
  setSelectedModel: (model: ModelConfig | null) => void;
  setBatchSize: (size: number) => void;
  setErrorColumn: (col: string) => void;
  startBatch: (params: BatchStartParams) => Promise<void>;
  pauseBatch: () => void;
  resumeBatch: () => void;
  stopBatch: () => void;
  reset: () => void;
  addLog: (log: BatchLog) => void;
  clearLogs: () => void;

  // 内部状态
  _abortController: AbortController | null;
  _pauseController: PauseController | null;
}

export const useProcessingStore = create<ProcessingStore>((set, get) => ({
  isRunning: false,
  batchProgress: null,
  batchLogs: [],
  selectedPromptId: null,
  customPrompt: '',
  inputColumns: [],
  outputColumn: '',
  modelParams: { temperature: 0.3 },
  selectedModel: null,
  batchSize: 3,
  errorColumn: 'AI错误',
  _abortController: null,
  _pauseController: null,

  setCustomPrompt: (prompt) => set({ customPrompt: prompt }),
  setSelectedPromptId: (id) => set({ selectedPromptId: id }),
  setInputColumns: (cols) => set({ inputColumns: cols }),
  setOutputColumn: (col) => set({ outputColumn: col }),
  setModelParams: (params) =>
    set((state) => ({
      modelParams: { ...state.modelParams, ...params },
    })),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setBatchSize: (size) => set({ batchSize: size }),
  setErrorColumn: (col) => set({ errorColumn: col }),

  startBatch: async (params) => {
    const state = get();
    const model = state.selectedModel;

    if (!model) {
      get().addLog({
        id: `error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: '请先选择要使用的大模型',
        level: 'error',
      });
      return;
    }

    if (!model.apiKey) {
      get().addLog({
        id: `error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: '所选模型缺少 API Key，请在配置页面检查',
        level: 'error',
      });
      return;
    }

    // 创建中止和暂停控制器
    const abortController = new AbortController();
    const pauseController = new PauseController();

    set({
      isRunning: true,
      batchProgress: { batchId: '', current: 0, total: 0, speed: 0, status: 'running' },
      batchLogs: [],
      _abortController: abortController,
      _pauseController: pauseController,
    });

    get().addLog({
      id: `start-${Date.now()}`,
      timestamp: new Date().toISOString(),
      row: -1,
      content: `开始批量处理，使用模型: ${model.name}`,
      level: 'info',
    });

    try {
      await runLLMBatch(
        {
          filePath: params.filePath,
          sheet: params.sheet,
          inputColumns: params.inputColumns,
          outputColumn: params.outputColumn,
          errorColumn: state.errorColumn,
          prompt: params.prompt,
          model: {
            baseUrl: model.baseUrl,
            apiKey: model.apiKey,
            modelId: model.modelId,
          },
          batchSize: state.batchSize,
          temperature: state.modelParams.temperature,
          onLog: (log) => get().addLog(log),
          onProgress: (current, total, speed) => {
            set({
              batchProgress: {
                batchId: '',
                current,
                total,
                speed,
                status: get()._pauseController?.paused ? 'paused' : 'running',
              },
            });
          },
          onRowComplete: (row, result) => {
            // 可选：额外的行完成回调
          },
          onRowError: (row, error) => {
            // 可选：额外的行错误回调
          },
          signal: abortController.signal,
        },
        pauseController,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      get().addLog({
        id: `fatal-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: `批量处理异常: ${msg}`,
        level: 'error',
      });
    } finally {
      set((s) => ({
        isRunning: false,
        batchProgress: s.batchProgress
          ? { ...s.batchProgress, status: 'completed' }
          : null,
        _abortController: null,
        _pauseController: null,
      }));
    }
  },

  pauseBatch: () => {
    const pauseCtrl = get()._pauseController;
    if (pauseCtrl) {
      pauseCtrl.pause();
      set((s) => ({
        batchProgress: s.batchProgress
          ? { ...s.batchProgress, status: 'paused' }
          : null,
      }));
      get().addLog({
        id: `pause-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: '批量处理已暂停',
        level: 'warning',
      });
    }
  },

  resumeBatch: () => {
    const pauseCtrl = get()._pauseController;
    if (pauseCtrl) {
      pauseCtrl.resume();
      set((s) => ({
        batchProgress: s.batchProgress
          ? { ...s.batchProgress, status: 'running' }
          : null,
      }));
      get().addLog({
        id: `resume-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: '批量处理已继续',
        level: 'info',
      });
    }
  },

  stopBatch: () => {
    const abortCtrl = get()._abortController;
    if (abortCtrl) {
      abortCtrl.abort();
      set({
        isRunning: false,
        batchProgress: null,
        _abortController: null,
        _pauseController: null,
      });
      get().addLog({
        id: `stop-${Date.now()}`,
        timestamp: new Date().toISOString(),
        row: -1,
        content: '批量处理已停止',
        level: 'warning',
      });
    }
  },

  reset: () => {
    set({
      isRunning: false,
      batchProgress: null,
      batchLogs: [],
      inputColumns: [],
      outputColumn: '',
      _abortController: null,
      _pauseController: null,
    });
  },

  addLog: (log) =>
    set((state) => ({ batchLogs: [...state.batchLogs, log] })),

  clearLogs: () => set({ batchLogs: [] }),
}));
