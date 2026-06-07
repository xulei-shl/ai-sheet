export interface BatchStartParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  prompt: string;
  savePrompt?: boolean;
  promptName?: string;
}

export interface BatchProgress {
  batchId: string;
  current: number;
  total: number;
  speed: number;
  status: 'running' | 'paused' | 'completed' | 'error';
}

export interface BatchLog {
  id: string;
  timestamp: string;
  row: number;
  content: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

export interface BatchStatus {
  batchId: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  progress: number;
  current: number;
  total: number;
  speed: number;
  message?: string;
}
