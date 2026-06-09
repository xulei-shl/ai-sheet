/**
 * llmBatchService.ts — LLM 批处理编排核心
 *
 * 按批次处理：每批 batchSize 条并发调用 LLM，全部完成后一次性写回 Excel，再进入下一批。
 * 优点：
 *   - LLM 调用并发加速
 *   - 同批内结果批量写入，避免并发写文件导致损坏
 *   - 每批完成即持久化，中断不丢失已完成批次
 */

import { callOpenAIChat } from './openaiClient';
import { getColumnData, writeExcelResults } from './tauri';
import type { BatchLog } from '../types/processing';

export interface LLMBatchParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  errorColumn: string;
  prompt: string;
  model: { baseUrl: string; apiKey: string; modelId: string };
  batchSize: number;
  temperature: number;
  onLog: (log: BatchLog) => void;
  onProgress: (current: number, total: number, speed: number) => void;
  onRowComplete: (row: number, result: string) => void;
  onRowError: (row: number, error: string) => void;
  signal: AbortSignal;
}

// ── 暂停控制器 ──

export class PauseController {
  private _paused = false;
  private waiters: Array<() => void> = [];

  get paused() { return this._paused; }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    for (const w of this.waiters) w();
    this.waiters = [];
  }

  async waitIfPaused(): Promise<void> {
    if (!this._paused) return;
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

// ── 提示词构建 ──

function buildRowPrompt(
  template: string,
  row: Record<string, string>,
  inputColumns: string[],
): string {
  let prompt = template;
  let hasPlaceholder = false;
  for (const col of inputColumns) {
    const placeholder = `{${col}}`;
    if (prompt.includes(placeholder)) {
      hasPlaceholder = true;
      prompt = prompt.replaceAll(placeholder, row[col] ?? '');
    }
  }

  if (!hasPlaceholder) {
    const combined = inputColumns.map((c) => row[c] ?? '').join('|||');
    prompt = `${prompt}\n${combined}`;
  }

  return prompt;
}

// ── 单行 LLM 调用 ──

async function callLLMForRow(
  rowIdx: number,
  row: Record<string, string>,
  inputColumns: string[],
  prompt: string,
  model: LLMBatchParams['model'],
  temperature: number,
  signal: AbortSignal,
  onLog: (log: BatchLog) => void,
): Promise<{ row: number; result: string; error?: undefined } | { row: number; error: string; result?: undefined }> {
  const rowPrompt = buildRowPrompt(prompt, row, inputColumns);

  const messages = [
    { role: 'system' as const, content: '你是一个数据处理助手。根据用户指令处理数据，只返回处理结果，不要解释。' },
    { role: 'user' as const, content: rowPrompt },
  ];

  try {
    const result = await callOpenAIChat({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      modelId: model.modelId,
      messages,
      temperature,
      signal,
    });
    return { row: rowIdx, result };
  } catch (err: unknown) {
    // 429 限流：退避重试 1 次
    if (err instanceof Error && /429/.test(err.message)) {
      onLog(makeLog(rowIdx, `第 ${rowIdx + 1} 行触发限流，2 秒后重试...`, 'warning'));
      await new Promise((r) => setTimeout(r, 2000));
      if (signal.aborted) {
        return { row: rowIdx, error: '已中止' };
      }
      try {
        const result = await callOpenAIChat({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          modelId: model.modelId,
          messages,
          temperature,
          signal,
        });
        return { row: rowIdx, result };
      } catch (retryErr: unknown) {
        const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return { row: rowIdx, error: msg };
      }
    }

    const msg = err instanceof Error ? err.message : String(err);
    return { row: rowIdx, error: msg };
  }
}

// ── 主流程 ──

export async function runLLMBatch(
  params: LLMBatchParams,
  pauseCtrl: PauseController,
): Promise<void> {
  const {
    filePath, sheet, inputColumns, outputColumn, errorColumn,
    prompt, model, batchSize, temperature,
    onLog, onProgress, onRowComplete, onRowError, signal,
  } = params;

  // 1. 读取 Excel 列数据
  onLog(makeLog(-1, '正在读取 Excel 数据...', 'info'));

  const colData = await getColumnData(filePath, sheet, inputColumns);
  const totalRows = colData.totalRows;

  onLog(makeLog(-1, `读取完成，共 ${totalRows} 行数据`, 'info'));

  if (totalRows === 0) {
    onLog(makeLog(-1, '没有数据需要处理', 'warning'));
    return;
  }

  // 构建行数据映射
  const rows: Array<Record<string, string>> = colData.rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < inputColumns.length; i++) {
      obj[inputColumns[i]] = row[i] ?? '';
    }
    return obj;
  });

  const startTime = Date.now();
  let completed = 0;

  // 2. 按批次处理
  for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
    // 检查中止
    if (signal.aborted) {
      onLog(makeLog(-1, '批量处理已中止', 'warning'));
      return;
    }

    // 等待暂停恢复
    await pauseCtrl.waitIfPaused();
    if (signal.aborted) {
      onLog(makeLog(-1, '批量处理已中止', 'warning'));
      return;
    }

    const batchEnd = Math.min(batchStart + batchSize, rows.length);
    const batchIndices: number[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      batchIndices.push(i);
    }

    onLog(makeLog(-1, `批次 [${batchStart + 1}-${batchEnd}] 开始处理...`, 'info'));

    // 3. 本批内并发调用 LLM
    const batchOutcomes = await Promise.allSettled(
      batchIndices.map((idx) =>
        callLLMForRow(idx, rows[idx], inputColumns, prompt, model, temperature, signal, onLog)
      )
    );

    // 收集本批结果
    const successResults: Array<{ row: number; value: string }> = [];
    const errorResults: Array<{ row: number; value: string }> = [];

    batchOutcomes.forEach((outcome, i) => {
      const idx = batchIndices[i];
      if (outcome.status === 'fulfilled') {
        const val = outcome.value;
        if (val.result !== undefined) {
          successResults.push({ row: val.row, value: val.result });
          onRowComplete(val.row, val.result);
          onLog(makeLog(val.row, `✓ ${truncate(val.result, 80)}`, 'success'));
        } else if (val.error !== undefined) {
          errorResults.push({ row: val.row, value: val.error });
          onRowError(val.row, val.error);
          onLog(makeLog(val.row, `✗ ${truncate(val.error, 80)}`, 'error'));
        }
      } else {
        // Promise 本身 rejected（不应发生，但防御性处理）
        const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        errorResults.push({ row: idx, value: msg });
        onRowError(idx, msg);
        onLog(makeLog(idx, `✗ ${truncate(msg, 80)}`, 'error'));
      }

      completed++;
    });

    // 更新进度
    const elapsed = (Date.now() - startTime) / 1000 / 60;
    const speed = elapsed > 0 ? completed / elapsed : 0;
    onProgress(completed, totalRows, speed);

    // 4. 本批结果一次性写回 Excel（串行写入，避免文件损坏）
    if (successResults.length > 0) {
      try {
        await writeExcelResults({
          path: filePath,
          sheet,
          column: outputColumn,
          results: successResults,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog(makeLog(-1, `批次 [${batchStart + 1}-${batchEnd}] 写入结果列失败: ${msg}`, 'error'));
      }
    }

    if (errorResults.length > 0) {
      try {
        await writeExcelResults({
          path: filePath,
          sheet,
          column: errorColumn,
          results: errorResults,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog(makeLog(-1, `批次 [${batchStart + 1}-${batchEnd}] 写入错误列失败: ${msg}`, 'error'));
      }
    }

    onLog(makeLog(-1, `批次 [${batchStart + 1}-${batchEnd}] 写入完成 (成功 ${successResults.length}, 失败 ${errorResults.length})`, 'info'));
  }

  onLog(makeLog(-1, `批量处理完成，共处理 ${completed} 行`, 'success'));
}

// ── 工具函数 ──

function makeLog(row: number, content: string, level: BatchLog['level']): BatchLog {
  return {
    id: `log-${row}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    row,
    content,
    level,
  };
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}
