import { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Play,
  Pause,
  Square,
  FileSpreadsheet,
  AlertCircle,
  Terminal,
  Table,
  ChevronDown,
  ChevronRight,
  Cpu,
} from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { usePromptStore } from '../stores/promptStore';
import { useProcessingStore } from '../stores/processingStore';
import { useConfigStore } from '../stores/configStore';
import { getColumnNames } from '../services/tauri';
import type { ColumnInfo } from '../types/excel';
import { SearchableSelect } from '../components/excel/SearchableSelect';

export function LLMProcessingPage() {
  const { files, selections } = useExcelStore();
  const { prompts, getFilteredPrompts, fetchPrompts } = usePromptStore();
  const { userModels, fetchModels } = useConfigStore();
  const {
    isRunning,
    batchProgress,
    batchLogs,
    customPrompt,
    selectedPromptId,
    inputColumns,
    outputColumn,
    modelParams,
    selectedModel,
    batchSize,
    errorColumn,
    setCustomPrompt,
    setSelectedPromptId,
    setInputColumns,
    setOutputColumn,
    setModelParams,
    setSelectedModel,
    setBatchSize,
    setErrorColumn,
    startBatch,
    pauseBatch,
    resumeBatch,
    stopBatch,
    clearLogs,
    reset,
    addLog,
  } = useProcessingStore();

  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [promptMode, setPromptMode] = useState<'saved' | 'custom'>('saved');
  const [availableColumns, setAvailableColumns] = useState<ColumnInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<number[]>([0]);
  const [newColumnName, setNewColumnName] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const currentFile = files[selectedFileIdx];
  const currentSel = selections[selectedFileIdx];
  const sheets = currentSel?.sheetInfo ?? [];
  const filteredPrompts = getFilteredPrompts();

  // 过滤出 OpenAI Completions 协议的模型
  const openAIModels = userModels.filter(
    (m) => m.providerType === 'openai-completions'
  );

  useEffect(() => {
    fetchPrompts();
    fetchModels();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [batchLogs]);

  useEffect(() => {
    if (files.length > 0 && !selectedSheet) {
      const idx = selections.findIndex((s) => s.sheetInfo.length > 0);
      const selIdx = idx >= 0 ? idx : 0;
      const sel = selections[selIdx];
      if (sel && sel.sheetInfo.length > 0) {
        setSelectedFileIdx(selIdx);
        handleSheetChange(sel.sheetInfo[0].name, selIdx);
      }
    }
  }, [files]);

  const toggleExpand = (idx: number) => {
    setExpandedFiles((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleSheetChange = async (sheet: string, fileIdx = selectedFileIdx) => {
    setSelectedSheet(sheet);
    setInputColumns([]);
    setOutputColumn('');
    setNewColumnName('');
    const file = files[fileIdx];
    if (sheet && file) {
      try {
        const cols = await getColumnNames(file.path, sheet);
        setAvailableColumns(cols);
      } catch {
        setAvailableColumns([]);
      }
    } else {
      setAvailableColumns([]);
    }
  };

  const handleFocusSheet = (fileIdx: number, sheetName: string) => {
    setSelectedFileIdx(fileIdx);
    handleSheetChange(sheetName, fileIdx);
    setError(null);
  };

  const activePrompt =
    promptMode === 'saved'
      ? prompts.find((p) => p.id === selectedPromptId)?.content ?? ''
      : customPrompt;

  // 实际输出列：如果是新建列模式，使用用户输入的新列名
  const actualOutputColumn =
    outputColumn === '__new__' ? newColumnName : outputColumn;

  const handleStart = async () => {
    if (!currentFile || !selectedSheet || inputColumns.length === 0) {
      setError('请选择文件、Sheet 和输入列');
      return;
    }
    if (!actualOutputColumn) {
      setError('请选择或输入输出列名');
      return;
    }
    if (!activePrompt) {
      setError('请选择或输入提示词');
      return;
    }
    if (!selectedModel) {
      setError('请选择要使用的大模型');
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
      outputColumn: actualOutputColumn,
      prompt: activePrompt,
    });
  };

  const progressPercent = batchProgress && batchProgress.total > 0
    ? (batchProgress.current / batchProgress.total) * 100
    : 0;

  return (
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)]">
      {/* Left Sidebar: File Tree */}
      <div
        className="w-60 shrink-0 border-r flex flex-col overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>数据源</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {files.map((file, fi) => {
            const sel = selections[fi];
            const isExpanded = expandedFiles.includes(fi);
            return (
              <div key={fi} className="space-y-0.5">
                <div
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                  onClick={() => toggleExpand(fi)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0" style={{ color: 'var(--muted)' }} />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" style={{ color: 'var(--muted)' }} />
                  )}
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--primary)' }} />
                  <span className="text-[11px] font-medium truncate flex-1" title={file.name}>{file.name}</span>
                </div>
                {isExpanded && sel && (
                  <div className="pl-4 space-y-0.5">
                    {sel.sheetInfo.map((sheet) => {
                      const isActive = selectedFileIdx === fi && selectedSheet === sheet.name;
                      return (
                        <div
                          key={sheet.name}
                          className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] transition-all cursor-pointer ${
                            isActive
                              ? 'bg-[var(--primary-glow)] font-medium text-[var(--ink)]'
                              : 'hover:bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--ink)]'
                          }`}
                          onClick={() => handleFocusSheet(fi, sheet.name)}
                        >
                          <Table className="h-3 w-3 shrink-0" style={{ color: isActive ? 'var(--primary)' : 'var(--muted)' }} />
                          <span className="truncate flex-1">{sheet.name}</span>
                          <span className="text-[9px] opacity-60">({sheet.rowCount})</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="py-6 text-center text-[10px]" style={{ color: 'var(--muted)' }}>
              请先在"数据"页面导入文件
            </div>
          )}
        </div>
      </div>

      {/* Middle: Configuration Panel */}
      <div
        className="w-80 shrink-0 border-r flex flex-col overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>处理配置</span>
          <Bot className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Model Selection */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <Cpu className="h-3 w-3" />
              大模型选择
            </label>
            <SearchableSelect
              options={[
                { value: '', label: '选择模型' },
                ...openAIModels.map((m) => ({ value: m.name, label: m.name })),
              ]}
              value={selectedModel?.name ?? ''}
              onChange={(v) => {
                const model = typeof v === 'string' ? openAIModels.find((m) => m.name === v) ?? null : null;
                setSelectedModel(model);
              }}
              mode="single"
              placeholder="选择模型..."
              searchPlaceholder="搜索模型..."
              formatValue={(sel) => sel[0]?.label || '选择模型'}
            />
            {userModels.length > 0 && openAIModels.length === 0 && (
              <p className="text-[9px]" style={{ color: 'var(--warning)' }}>
                当前没有 OpenAI Completions 协议的模型，请在配置页面添加
              </p>
            )}
          </div>

          {/* Batch Size */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              批次大小（并发数）
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full rounded px-2 py-1.5 text-[11px]"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
          </div>

          {/* Input Columns Selector */}
          {availableColumns.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>输入列 (可多选)</label>
              <SearchableSelect
                options={availableColumns.map((c) => ({ value: c.name, label: c.name }))}
                value={inputColumns}
                onChange={(v) => setInputColumns(Array.isArray(v) ? v : [])}
                mode="multiple"
                placeholder="选择输入列..."
                searchPlaceholder="搜索输入列..."
              />
            </div>
          )}

          {/* Output Column */}
          {availableColumns.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>输出结果列</label>
              <SearchableSelect
                options={[
                  ...availableColumns
                    .filter((c) => !inputColumns.includes(c.name))
                    .map((c) => ({ value: c.name, label: c.name })),
                  { value: '__new__', label: '[新建列...]' },
                ]}
                value={outputColumn}
                onChange={(v) => setOutputColumn(typeof v === 'string' ? v : '')}
                mode="single"
                placeholder="选择输出列..."
                searchPlaceholder="搜索输出列..."
              />
              {outputColumn === '__new__' && (
                <input
                  type="text"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="输入新列名..."
                  className="w-full rounded px-2 py-1.5 text-[11px] mt-1"
                  style={{ background: 'var(--bg)', border: '1px solid var(--primary)', color: 'var(--ink)' }}
                />
              )}
            </div>
          )}

          {/* Error Column */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>错误信息列</label>
            <input
              type="text"
              value={errorColumn}
              onChange={(e) => setErrorColumn(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-[11px]"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
          </div>

          {/* Temperature */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>LLM 温度</label>
              <span className="text-[10px] font-mono px-1 rounded bg-[var(--bg)]" style={{ color: 'var(--primary)' }}>{modelParams.temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={modelParams.temperature}
              onChange={(e) => setModelParams({ temperature: parseFloat(e.target.value) })}
              className="w-full h-1.5 accent-[var(--primary)] cursor-pointer"
            />
          </div>

          {/* Prompt Setup */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--muted)' }}>提示词模板</label>
            <div className="mb-2 flex gap-1">
              <button
                type="button"
                onClick={() => setPromptMode('saved')}
                className={`flex-1 text-center py-1 rounded text-[10px] font-medium border cursor-pointer transition-colors ${
                  promptMode === 'saved'
                    ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--ink)]'
                    : 'border-[var(--border)] text-[var(--muted)]'
                }`}
              >
                已保存
              </button>
              <button
                type="button"
                onClick={() => setPromptMode('custom')}
                className={`flex-1 text-center py-1 rounded text-[10px] font-medium border cursor-pointer transition-colors ${
                  promptMode === 'custom'
                    ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--ink)]'
                    : 'border-[var(--border)] text-[var(--muted)]'
                }`}
              >
                自定义
              </button>
            </div>
            {promptMode === 'saved' ? (
              <SearchableSelect
                options={[
                  { value: '', label: '选择模板' },
                  ...filteredPrompts.map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={selectedPromptId ?? ''}
                onChange={(v) => setSelectedPromptId(typeof v === 'string' && v ? v : null)}
                mode="single"
                placeholder="选择模板"
                searchPlaceholder="搜索模板..."
                formatValue={(sel) => sel[0]?.label || '选择模板'}
              />
            ) : (
              <textarea
                className="w-full resize-none rounded px-2 py-1.5 text-[11px] focus-visible:outline-[var(--primary)]"
                rows={3}
                placeholder="输入处理提示词模板，可用 {列名} 引用数据，如：翻译以下文本：{原文}"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right Monitor Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Workspace Header */}
        <div className="p-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div>
            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>LLM 批量数据处理控制台</span>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Terminal className="h-4 w-4" style={{ color: 'var(--primary)' }} />
              {currentFile ? `${currentFile.name} · ${selectedSheet || '未选择'}` : '未加载数据'}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={!currentFile || !selectedSheet || inputColumns.length === 0 || !activePrompt || !selectedModel}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                style={{ background: 'var(--primary)' }}
              >
                <Play className="h-3 w-3" />
                开始
              </button>
            ) : (
              <>
                {batchProgress?.status === 'paused' ? (
                  <button
                    onClick={resumeBatch}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                    style={{ background: 'var(--primary)' }}
                  >
                    <Play className="h-3 w-3" />
                    继续
                  </button>
                ) : (
                  <button
                    onClick={pauseBatch}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-hover)] cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    <Pause className="h-3 w-3" />
                    暂停
                  </button>
                )}
                <button
                  onClick={stopBatch}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                  style={{ background: 'var(--error)' }}
                >
                  <Square className="h-3 w-3" />
                  停止
                </button>
              </>
            )}
            <button
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-hover)] cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              重置
            </button>
          </div>
        </div>

        {/* Console Area */}
        <div className="flex-1 flex flex-col min-h-0 p-3 gap-3">
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border p-2.5 text-xs shrink-0" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--error)' }} />
              <span className="flex-1" style={{ color: 'var(--error)' }}>{error}</span>
              <button onClick={() => setError(null)} className="text-xs font-medium hover:text-[var(--ink)] cursor-pointer shrink-0" style={{ color: 'var(--muted)' }}>关闭</button>
            </div>
          )}

          {/* Progress Card */}
          {batchProgress && batchProgress.total > 0 && (
            <div className="rounded-lg border p-3 space-y-2 shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  进度：{batchProgress.current} / {batchProgress.total}
                </span>
                <span className="font-semibold" style={{ color: 'var(--primary)' }}>{progressPercent.toFixed(1)}%</span>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progressPercent}%`,
                    background: batchProgress.status === 'paused' ? 'var(--muted)' : 'var(--primary)',
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--muted)' }}>
                <span>速度: {batchProgress.speed.toFixed(1)} 行/分</span>
                {batchProgress.speed > 0 && (
                  <span>预计剩余: {Math.ceil((batchProgress.total - batchProgress.current) / batchProgress.speed)} 分钟</span>
                )}
                <span className="font-medium" style={{ color: batchProgress.status === 'paused' ? 'oklch(0.7 0.12 80)' : 'var(--primary)' }}>
                  {batchProgress.status === 'running' ? '执行中' : batchProgress.status === 'paused' ? '已暂停' : '已完成'}
                </span>
              </div>
            </div>
          )}

          {/* Full-Height Terminal */}
          <div className="flex flex-col border rounded-lg overflow-hidden flex-1 min-h-0" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                <Terminal className="h-3 w-3" />
                终端日志 ({batchLogs.length})
              </span>
              {batchLogs.length > 0 && (
                <button
                  onClick={clearLogs}
                  className="text-[9px] hover:text-[var(--ink)] cursor-pointer"
                  style={{ color: 'var(--muted)' }}
                >
                  清空
                </button>
              )}
            </div>

            <div
              className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-1 select-text"
              style={{ background: 'var(--surface)' }}
            >
              {batchLogs.length > 0 ? (
                batchLogs.map((log) => {
                  let colorClass = 'text-slate-300';
                  if (log.level === 'error') colorClass = 'text-red-400 font-medium';
                  else if (log.level === 'success') colorClass = 'text-emerald-400';
                  else if (log.level === 'warning') colorClass = 'text-amber-400';

                  return (
                    <div key={log.id} className={`flex items-start gap-1.5 ${colorClass}`}>
                      <span className="opacity-40 shrink-0 select-none text-[9px]">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                      </span>
                      {log.row >= 0 && (
                        <span className="text-indigo-400 shrink-0 font-medium select-none text-[10px]">
                          [第 {log.row + 1} 行]
                        </span>
                      )}
                      <span className="break-all whitespace-pre-wrap">{log.content}</span>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex items-center justify-center text-xs opacity-35 select-none text-slate-500 font-sans">
                  控制台空闲，等待任务开始...
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
