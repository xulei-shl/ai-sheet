import { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Play,
  Pause,
  Square,
  FileSpreadsheet,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { usePromptStore } from '../stores/promptStore';
import { useProcessingStore } from '../stores/processingStore';
import { getColumnNames } from '../services/tauri';
import type { ColumnInfo } from '../types/excel';

export function LLMProcessingPage() {
  const { files, selections } = useExcelStore();
  const { prompts, getFilteredPrompts, fetchPrompts } = usePromptStore();
  const {
    isRunning,
    batchProgress,
    batchLogs,
    customPrompt,
    selectedPromptId,
    inputColumns,
    outputColumn,
    modelParams,
    setCustomPrompt,
    setSelectedPromptId,
    setInputColumns,
    setOutputColumn,
    setModelParams,
    startBatch,
    pauseBatch,
    resumeBatch,
    stopBatch,
    clearLogs,
    reset,
    addLog,
    subscribeToEvents,
  } = useProcessingStore();

  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [promptMode, setPromptMode] = useState<'saved' | 'custom'>('custom');
  const [availableColumns, setAvailableColumns] = useState<ColumnInfo[]>([]);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const currentFile = files[selectedFileIdx];
  const currentSel = selections[selectedFileIdx];
  const sheets = currentSel?.sheetInfo ?? [];
  const filteredPrompts = getFilteredPrompts();

  useEffect(() => {
    const unsub = subscribeToEvents();
    fetchPrompts();
    return unsub;
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [batchLogs]);

  const handleSheetChange = async (sheet: string) => {
    setSelectedSheet(sheet);
    setInputColumns([]);
    setOutputColumn('');
    if (sheet && currentFile) {
      try {
        const cols = await getColumnNames(currentFile.path, sheet);
        setAvailableColumns(cols);
      } catch { setAvailableColumns([]); }
    } else {
      setAvailableColumns([]);
    }
  };

  const activePrompt =
    promptMode === 'saved'
      ? prompts.find((p) => p.id === selectedPromptId)?.content ?? ''
      : customPrompt;

  const handleStart = async () => {
    if (!currentFile || !selectedSheet || inputColumns.length === 0 || !outputColumn || !activePrompt) {
      setError('请完善文件、Sheet、列和提示词选择');
      return;
    }
    setError(null);
    clearLogs();
    addLog({
      id: `start-${Date.now()}`,
      timestamp: new Date().toISOString(),
      row: -1,
      content: '开始批量处理...',
      level: 'info',
    });
    await startBatch({
      filePath: currentFile.path,
      sheet: selectedSheet,
      inputColumns,
      outputColumn,
      prompt: activePrompt,
    });
  };

  const progressPercent = batchProgress && batchProgress.total > 0
    ? (batchProgress.current / batchProgress.total) * 100
    : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <Bot className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            <h2 className="text-lg font-semibold">LLM 批量处理</h2>
          </div>

          {/* Configuration Panel */}
          <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {/* File Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Excel 文件</label>
                {files.length > 0 ? (
                  <select
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={selectedFileIdx}
                    onChange={(e) => { setSelectedFileIdx(Number(e.target.value)); setSelectedSheet(''); setAvailableColumns([]); }}
                  >
                    {files.map((f, i) => (
                      <option key={i} value={i}>{f.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex h-9 items-center rounded-md px-3 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    请先上传文件
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Sheet</label>
                <select
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  disabled={sheets.length === 0}
                >
                  <option value="">选择 Sheet</option>
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>{s.name} ({s.rowCount}行)</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Columns */}
            {availableColumns.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>输入列（选择要处理的列）</label>
                <div className="flex flex-wrap gap-2">
                  {availableColumns.map((col) => {
                    const isSelected = inputColumns.includes(col.name);
                    return (
                      <button
                        key={col.name}
                        onClick={() => {
                          setInputColumns(
                            isSelected
                              ? inputColumns.filter((c) => c !== col.name)
                              : [...inputColumns, col.name],
                          );
                        }}
                        className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                          isSelected
                            ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--primary)]'
                            : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {col.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {availableColumns.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>输出列</label>
                  <select
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={outputColumn}
                    onChange={(e) => setOutputColumn(e.target.value)}
                  >
                    <option value="">选择输出列</option>
                    {availableColumns
                      .filter((c) => !inputColumns.includes(c.name))
                      .map((col) => (
                        <option key={col.name} value={col.name}>{col.name}</option>
                      ))}
                    <option value="__new__">[新建列] AI结果</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>温度</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={modelParams.temperature}
                    onChange={(e) => setModelParams({ temperature: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{modelParams.temperature}</span>
                </div>
              </div>
            )}

            {/* Prompt Selection */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>提示词</label>
              <div className="mb-2 flex gap-2">
                <button
                  onClick={() => setPromptMode('saved')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    promptMode === 'saved'
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'border text-[var(--muted)]'
                  }`}
                  style={promptMode === 'saved' ? {} : { borderColor: 'var(--border)' }}
                >
                  已保存
                </button>
                <button
                  onClick={() => setPromptMode('custom')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    promptMode === 'custom'
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'border text-[var(--muted)]'
                  }`}
                  style={promptMode === 'custom' ? {} : { borderColor: 'var(--border)' }}
                >
                  自定义
                </button>
              </div>
              {promptMode === 'saved' ? (
                <select
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={selectedPromptId ?? ''}
                  onChange={(e) => setSelectedPromptId(e.target.value || null)}
                >
                  <option value="">选择已保存提示词</option>
                  {filteredPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  className="w-full resize-none rounded-md px-3 py-2 text-sm"
                  rows={3}
                  placeholder="输入处理提示词，如：请将以下文本翻译成英文..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {!isRunning ? (
                <button
                  onClick={handleStart}
                  disabled={!currentFile || !selectedSheet || inputColumns.length === 0 || !activePrompt}
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Play className="h-4 w-4" />
                  开始处理
                </button>
              ) : (
                <>
                  {batchProgress?.status === 'paused' ? (
                    <button
                      onClick={resumeBatch}
                      className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      <Play className="h-4 w-4" />
                      继续
                    </button>
                  ) : (
                    <button
                      onClick={pauseBatch}
                      className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    >
                      <Pause className="h-4 w-4" />
                      暂停
                    </button>
                  )}
                  <button
                    onClick={stopBatch}
                    className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--error)', color: 'white' }}
                  >
                    <Square className="h-4 w-4" />
                    停止
                  </button>
                </>
              )}
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                重置
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <AlertCircle className="h-4 w-4" style={{ color: 'var(--error)' }} />
              <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-sm" style={{ color: 'var(--muted)' }}>关闭</button>
            </div>
          )}

          {/* Progress */}
          {batchProgress && batchProgress.total > 0 && (
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--ink)' }}>
                  {batchProgress.current} / {batchProgress.total} 行
                </span>
                <span style={{ color: 'var(--muted)' }}>{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progressPercent}%`,
                    background: batchProgress.status === 'paused' ? 'var(--muted)' : 'var(--primary)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span>
                  速度: {batchProgress.speed.toFixed(1)} 行/分钟
                </span>
                {batchProgress.speed > 0 && (
                  <span>
                    预计剩余: {Math.ceil((batchProgress.total - batchProgress.current) / batchProgress.speed)} 分钟
                  </span>
                )}
                <span style={{ color: batchProgress.status === 'paused' ? 'var(--warning, #f59e0b)' : 'var(--primary)' }}>
                  {batchProgress.status === 'running' ? '处理中...' : batchProgress.status === 'paused' ? '已暂停' : batchProgress.status}
                </span>
              </div>
            </div>
          )}

          {/* Logs */}
          {batchLogs.length > 0 && (
            <div className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <div
                className="flex items-center justify-between border-b px-4 py-2 cursor-pointer"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                onClick={() => setPreviewExpanded(!previewExpanded)}
              >
                <span className="text-sm font-medium">处理日志 ({batchLogs.length})</span>
                {previewExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              {previewExpanded && (
                <div className="max-h-64 overflow-auto p-2 space-y-1">
                  {batchLogs.map((log) => (
                    <div key={log.id} className="flex gap-2 rounded px-2 py-1 text-xs" style={{
                      background: log.level === 'error' ? 'oklch(0.6 0.12 20 / 0.08)' :
                        log.level === 'success' ? 'oklch(0.65 0.1 150 / 0.08)' :
                        log.level === 'warning' ? 'oklch(0.7 0.12 80 / 0.08)' : 'transparent',
                    }}>
                      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {log.row >= 0 ? `第${log.row + 1}行` : ''}
                      </span>
                      <span style={{ color: 'var(--ink)' }}>{log.content}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {files.length === 0 && (
            <div className="py-16 text-center">
              <FileSpreadsheet className="mx-auto mb-4 h-12 w-12" style={{ color: 'var(--muted)' }} />
              <h3 className="mb-1 text-base font-medium">请先上传 Excel 文件</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>在左侧"数据"页面上传后，即可在此处进行 LLM 批量处理</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
