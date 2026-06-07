export type ProgressCallback = (progress: BatchProgressUpdate) => void;

export interface BatchProgressUpdate {
  batchId: string;
  current: number;
  total: number;
  speed: number;
  status: 'running' | 'paused' | 'completed' | 'error';
  message?: string;
}

export interface RowCompleteUpdate {
  batchId: string;
  row: number;
  result: string;
}

export class ProgressTracker {
  private batchId: string;
  private startTime: number;
  private processedCount: number;
  private totalCount: number;
  private currentSpeed: number;
  private callbacks: Set<ProgressCallback> = new Set();

  constructor(batchId: string) {
    this.batchId = batchId;
    this.startTime = Date.now();
    this.processedCount = 0;
    this.totalCount = 0;
    this.currentSpeed = 0;
  }

  setTotal(total: number) {
    this.totalCount = total;
  }

  onProgress(callback: ProgressCallback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  tick(row: number, result: string) {
    this.processedCount++;
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.currentSpeed = elapsed > 0 ? this.processedCount / (elapsed / 60) : 0;

    const update: BatchProgressUpdate = {
      batchId: this.batchId,
      current: this.processedCount,
      total: this.totalCount,
      speed: Math.round(this.currentSpeed * 10) / 10,
      status: 'running',
    };

    for (const cb of this.callbacks) {
      cb(update);
    }
  }

  getStats() {
    const elapsed = Date.now() - this.startTime;
    return {
      batchId: this.batchId,
      totalRows: this.totalCount,
      processedRows: this.processedCount,
      totalTimeMs: elapsed,
      avgSpeed: this.currentSpeed,
      successCount: this.processedCount,
      errorCount: 0,
    };
  }
}
