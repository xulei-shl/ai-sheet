import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BridgeClient } from '../bridge.js';
import { ProgressTracker, type ProgressCallback, type RowCompleteUpdate } from './progress.js';
import { stream } from '@earendil-works/pi-ai';
import { buildModel } from '../provider-map.js';

interface BatchRunParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  prompt: string;
  modelId?: string;
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

interface ColumnData {
  columns: string[];
  rows: Array<Record<string, string>>;
  combined: string[];
  total_rows: number;
}

interface ProcessingStatus {
  processedRows: number[];
  totalRows: number;
}

export class BatchRunner {
  private abortController: AbortController | null = null;
  private paused = false;
  private pausePromise: Promise<void> | null = null;
  private pauseResolve: (() => void) | null = null;
  private bridge: BridgeClient;
  private checkpointDir: string;
  private progressCallbacks: Set<ProgressCallback> = new Set();
  private rowCompleteCallbacks: Set<(update: RowCompleteUpdate) => void> = new Set();

  constructor(bridge: BridgeClient) {
    this.bridge = bridge;
    this.checkpointDir = join(process.cwd(), '.batch-checkpoints');
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  onProgress(cb: ProgressCallback) {
    this.progressCallbacks.add(cb);
    return () => this.progressCallbacks.delete(cb);
  }

  onRowComplete(cb: (update: RowCompleteUpdate) => void) {
    this.rowCompleteCallbacks.add(cb);
    return () => this.rowCompleteCallbacks.delete(cb);
  }

  async run(params: BatchRunParams): Promise<void> {
    this.abortController = new AbortController();
    this.paused = false;

    const tracker = new ProgressTracker(this._generateBatchId());

    try {
      const data = await this.bridge.post<ColumnData>('/api/excel/columns', {
        path: params.filePath,
        sheet: params.sheet,
        columns: params.inputColumns,
      });

      tracker.setTotal(data.total_rows);

      const resumeFrom = await this._getCheckpoint(tracker);
      const model = this._resolveModel(params);
      const temperature = params.temperature ?? 0.3;
      const apiKey = params.apiKey;

      for (let i = resumeFrom; i < data.rows.length; i++) {
        if (this.abortController.signal.aborted) break;

        while (this.paused) {
          this._emitProgress(tracker, 'paused');
          await this.pausePromise;
        }

        if (this.abortController.signal.aborted) break;

        const row = data.rows[i];
        const combined = data.combined[i];

        const processedStatus = await this.bridge.post<ProcessingStatus>('/api/excel/processing-status', {
          path: params.filePath,
          sheet: params.sheet,
          resultColumn: params.outputColumn,
        });

        if (processedStatus.processedRows.includes(i)) {
          tracker.tick(i + 1, '(已处理，跳过)');
          continue;
        }

        try {
          const result = await this._processRowWithRetry(
            model,
            params.prompt,
            params.inputColumns,
            row,
            combined,
            temperature,
            apiKey,
            3,
          );

          await this.bridge.post('/api/excel/write', {
            path: params.filePath,
            sheet: params.sheet,
            column: params.outputColumn,
            results: [{ row: i, value: result }],
          });

          tracker.tick(i + 1, result);

          for (const cb of this.rowCompleteCallbacks) {
            cb({ batchId: '', row: i, result });
          }

          this._saveCheckpoint(i + 1);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this._emitError(tracker, message);
          break;
        }
      }

      if (this.abortController.signal.aborted) {
        this._emitProgress(tracker, 'error', '已手动停止');
      } else {
        this._emitProgress(tracker, 'completed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._emitError(tracker, message);
    }
  }

  pause() {
    this.paused = true;
    this.pausePromise = new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
  }

  resume() {
    this.paused = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
      this.pausePromise = null;
    }
  }

  abort() {
    this.abortController?.abort();
    if (this.paused) {
      this.resume();
    }
  }

  get isPaused() {
    return this.paused;
  }

  private _resolveModel(params: BatchRunParams) {
    if (params.providerType && params.modelId) {
      return buildModel({
        providerType: params.providerType,
        modelId: params.modelId,
        baseUrl: params.baseUrl,
      });
    }
    return null;
  }

  private async _processRowWithRetry(
    model: any,
    promptTemplate: string,
    inputColumns: string[],
    row: Record<string, string>,
    combined: string,
    temperature: number,
    apiKey: string | undefined,
    maxRetries: number,
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const finalPrompt = promptTemplate.replace(/\{combined\}/g, combined);
        const result = await this._callLLM(model, finalPrompt, temperature, apiKey);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('处理失败');
  }

  private async _callLLM(model: any, prompt: string, temperature: number, apiKey?: string): Promise<string> {
    if (model) {
      const options: any = { temperature };
      if (apiKey) options.apiKey = apiKey;

      const eventStream = stream(model, {
        systemPrompt: '你是一个数据处理助手。根据用户指令处理数据，只返回处理结果，不要解释。',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
      }, options);

      let text = '';
      for await (const event of eventStream) {
        if (event.type === 'done') {
          for (const content of event.message.content) {
            if (content.type === 'text') {
              text += content.text;
            }
          }
        }
        if (event.type === 'error') {
          throw new Error(event?.error?.errorMessage ?? 'LLM 处理失败');
        }
      }
      return text.trim();
    }

    return `[模拟处理结果] ${prompt.substring(0, 100)}...`;
  }

  private _generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private async _getCheckpoint(tracker: ProgressTracker): Promise<number> {
    const checkpointPath = join(this.checkpointDir, `${tracker}.json`);
    if (existsSync(checkpointPath)) {
      try {
        const data = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
        return data.processedCount ?? 0;
      } catch {
        // corrupted checkpoint, start fresh
      }
    }
    return 0;
  }

  private _saveCheckpoint(processedCount: number) {
    const checkpointPath = join(this.checkpointDir, `checkpoint.json`);
    try {
      writeFileSync(checkpointPath, JSON.stringify({ processedCount, timestamp: Date.now() }));
    } catch {
      // non-critical
    }
  }

  private _emitProgress(tracker: ProgressTracker, status: 'running' | 'paused' | 'completed' | 'error', message?: string) {
    const update = tracker.getStats();
    for (const cb of this.progressCallbacks) {
      cb({
        batchId: update.batchId,
        current: update.processedRows,
        total: update.totalRows,
        speed: update.avgSpeed,
        status,
        message,
      });
    }
  }

  private _emitError(tracker: ProgressTracker, message: string) {
    this._emitProgress(tracker, 'error', message);
  }
}
