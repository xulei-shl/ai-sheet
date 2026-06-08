import { useState, useEffect, type DragEvent } from 'react';
import { FileSpreadsheet, Upload, X, Table, ChevronDown, ChevronRight, Check, Eraser } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useExcelStore } from '../stores/excelStore';
import { useAgentStore } from '../stores/agentStore';
import { getColumnNames } from '../services/tauri';
import { ExcelTable } from '../components/excel/ExcelTable';
import { ColumnSelector } from '../components/excel/ColumnSelector';
import { Tooltip } from '../components/ui/Tooltip';

export function DataPage() {
  const {
    files,
    selections,
    loading,
    error,
    includeSampleData,
    addFile,
    removeFile,
    selectSheets,
    selectColumns,
    loadPreview,
    notifyContextChange,
    clearError,
    setIncludeSampleData,
  } = useExcelStore();

  const clearMessages = useAgentStore((s) => s.clearMessages);
  
  const [dragging, setDragging] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<number[]>([0]);
  const [toast, setToast] = useState<{ type: 'warning' | 'success'; message: string } | null>(null);
  
  const [activeFileIdx, setActiveFileIdx] = useState<number | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
  const [prevFilesLength, setPrevFilesLength] = useState(0);

  const showToast = (type: 'warning' | 'success', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDragOver = (e: DragEvent) => { 
    e.preventDefault(); 
    setDragging(true); 
  };
  
  const handleDragLeave = () => {
    setDragging(false); 
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      const webviewPath = (file as unknown as { path: string }).path;
      if (webviewPath) await addFile(webviewPath);
    }
  };

  const handleClickOpen = async () => {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Excel 文件',
        extensions: ['xlsx', 'xls'],
      }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        await addFile(path);
      }
    }
  };

  const toggleExpand = (idx: number) => {
    setExpandedFiles((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  // Auto-focus the first sheet of newly added files
  useEffect(() => {
    if (files.length > prevFilesLength) {
      const newIdx = files.length - 1;
      setExpandedFiles((prev) => [...new Set([...prev, newIdx])]);
      const sel = selections[newIdx];
      if (sel && sel.sheetInfo.length > 0) {
        handleFocusSheet(newIdx, sel.sheetInfo[0].name);
      }
    }
    setPrevFilesLength(files.length);
  }, [files, selections]);

  // Set default active file/sheet if none is focused
  useEffect(() => {
    if (files.length > 0 && (activeFileIdx === null || activeSheetName === null)) {
      const firstSelIndex = selections.findIndex((s) => s.sheetInfo.length > 0);
      const idx = firstSelIndex >= 0 ? firstSelIndex : 0;
      const sel = selections[idx];
      if (sel && sel.sheetInfo.length > 0) {
        handleFocusSheet(idx, sel.sheetInfo[0].name);
      }
    }
  }, [files]);

  const handleFocusSheet = async (fileIndex: number, sheet: string) => {
    setActiveFileIdx(fileIndex);
    setActiveSheetName(sheet);

    const sel = selections[fileIndex];
    if (!sel) return;

    if (!sel.columnInfo[sheet]) {
      try {
        const cols = await getColumnNames(sel.file.path, sheet);
        useExcelStore.setState((s) => {
          const updated = [...s.selections];
          updated[fileIndex] = {
            ...updated[fileIndex],
            columnInfo: { ...updated[fileIndex].columnInfo, [sheet]: cols },
            selectedColumns: { ...updated[fileIndex].selectedColumns, [sheet]: updated[fileIndex].selectedColumns[sheet] ?? [] },
          };
          return { selections: updated };
        });
      } catch {
        // ignore
      }
    }

    if (!sel.previewData[sheet]) {
      await loadPreview(fileIndex, sheet);
    }
  };

  const handleSheetToggle = async (fileIndex: number, sheet: string) => {
    const sel = selections[fileIndex];
    if (!sel) return;
    const isSelected = sel.selectedSheets.includes(sheet);

    const newSheets = isSelected
      ? sel.selectedSheets.filter((s) => s !== sheet)
      : [...sel.selectedSheets, sheet];
    await selectSheets(fileIndex, newSheets);
  };

  const handleRemoveFile = (idx: number) => {
    removeFile(idx);
    if (activeFileIdx === idx) {
      setActiveFileIdx(null);
      setActiveSheetName(null);
    } else if (activeFileIdx !== null && activeFileIdx > idx) {
      setActiveFileIdx(activeFileIdx - 1);
    }
  };

  const handleLoadToContext = () => {
    if (!selections.some((s) => s.selectedSheets.length > 0)) {
      showToast('warning', '请先选择 Sheet 并将其加入上下文');
      return;
    }
    notifyContextChange();
    showToast('success', '已加载到 AI Agent 上下文');
  };

  // Render Empty State if no files uploaded
  if (files.length === 0 && !loading) {
    return (
      <div 
        className="flex h-full items-center justify-center p-6 bg-[var(--bg)] relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold">数据加载</h2>
            <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>导入 Excel 文件，开始筛选列并生成数据预览</p>
          </div>

          {toast && (
            <div
              className="rounded-lg border p-3 text-sm text-center"
              style={{
                borderColor: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
                background: toast.type === 'warning' ? 'oklch(0.6 0.12 20 / 0.1)' : 'oklch(0.5 0.15 150 / 0.1)',
                color: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
              }}
            >
              {toast.message}
            </div>
          )}

          {error && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
                <button onClick={clearError} className="text-sm font-medium hover:text-[var(--ink)] cursor-pointer" style={{ color: 'var(--muted)' }}>关闭</button>
              </div>
            </div>
          )}

          <div
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-all duration-200 ${
              dragging
                ? 'border-[var(--primary)] bg-[var(--primary-glow)] scale-[1.02]'
                : 'border-[var(--border)] hover:border-[var(--primary)] bg-[var(--surface)]'
            }`}
            onClick={handleClickOpen}
            role="button"
            tabIndex={0}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'var(--primary-glow)' }}>
              <FileSpreadsheet className="h-8 w-8" style={{ color: 'var(--primary)' }} />
            </div>
            <p className="font-medium text-sm">拖放 Excel 文件到此处</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>或点击此处浏览文件 (支持 .xlsx / .xls)</p>
          </div>
        </div>
      </div>
    );
  }

  // Active sheet context variables
  const activeSel = activeFileIdx !== null ? selections[activeFileIdx] : null;
  const activeSheet = activeSel?.sheetInfo.find((s) => s.name === activeSheetName);
  const isActiveSheetSelected = (activeSel && activeSheetName) ? activeSel.selectedSheets.includes(activeSheetName) : false;
  const activeSheetColumns = (activeSel && activeSheetName) ? (activeSel.columnInfo[activeSheetName] || []) : [];
  const activeSheetSelectedColumns = (activeSel && activeSheetName) ? (activeSel.selectedColumns[activeSheetName] || []) : [];
  const activeSheetPreviewData = (activeSel && activeSheetName) ? (activeSel.previewData[activeSheetName] || null) : null;

  return (
    <div 
      className="flex h-full flex-row overflow-hidden relative bg-[var(--bg)]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* File Drop Overlay (visible when dragging) */}
      {dragging && (
        <div 
          className="absolute inset-0 z-50 flex flex-col items-center justify-center border-4 border-dashed"
          style={{ 
            borderColor: 'var(--primary)', 
            background: 'oklch(from var(--bg) l c h / 0.9)',
            backdropFilter: 'blur(2px)'
          }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full mb-4" style={{ background: 'var(--primary-glow)' }}>
            <Upload className="h-8 w-8 text-[var(--primary)]" />
          </div>
          <p className="text-base font-semibold">释放以导入 Excel 文件</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>支持 .xlsx / .xls 格式</p>
        </div>
      )}

      {/* Left Sidebar: Data Sources */}
      <div 
        className="w-72 shrink-0 border-r flex flex-col overflow-hidden" 
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>数据源</span>
          <button
            onClick={handleClickOpen}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
            style={{ background: 'var(--primary)' }}
          >
            <Upload className="h-3 w-3" />
            导入
          </button>
        </div>

        {/* Sidebar Loading indicator */}
        {loading && (
          <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="h-3 w-3 animate-spin rounded-full border border-[var(--primary)] border-t-transparent" />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>处理中...</span>
          </div>
        )}

        {/* Sidebar File Tree */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {files.map((file, fi) => {
            const sel = selections[fi];
            const isExpanded = expandedFiles.includes(fi);
            return (
              <div key={fi} className="space-y-1">
                {/* File Header Card */}
                <div 
                  className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-[var(--surface-hover)] cursor-pointer group transition-colors"
                  onClick={() => toggleExpand(fi)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    )}
                    <FileSpreadsheet className="h-4 w-4 shrink-0" style={{ color: 'var(--primary)' }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" title={file.name}>{file.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(fi); }}
                    className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-hover)] transition-opacity cursor-pointer text-xs"
                    style={{ color: 'var(--muted)' }}
                    title="移除文件"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Sheet Sub-items */}
                {isExpanded && sel && (
                  <div className="pl-4 space-y-0.5">
                    {sel.sheetInfo.map((sheet) => {
                      const isSheetSelected = sel.selectedSheets.includes(sheet.name);
                      const isSheetFocused = activeFileIdx === fi && activeSheetName === sheet.name;
                      return (
                        <div
                          key={sheet.name}
                          className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs transition-all duration-150 cursor-pointer ${
                            isSheetFocused
                              ? 'bg-[var(--primary-glow)] font-medium text-[var(--ink)]'
                              : 'hover:bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--ink)]'
                          }`}
                          onClick={() => handleFocusSheet(fi, sheet.name)}
                        >
                          <input
                            type="checkbox"
                            checked={isSheetSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleSheetToggle(fi, sheet.name);
                            }}
                            className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)] cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Table className="h-3.5 w-3.5 shrink-0" style={{ color: isSheetSelected ? 'var(--primary)' : 'var(--muted)' }} />
                          <span className="truncate flex-1" title={sheet.name}>{sheet.name}</span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>({sheet.rowCount})</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Panel: Workspace */}
      <div className="flex-1 flex flex-col overflow-auto min-w-0">
        {/* Errors & Toasts */}
        <div className="px-6 pt-4 space-y-2 shrink-0">
          {toast && (
            <div
              className="rounded-lg border p-3 text-xs animate-fade-in"
              style={{
                borderColor: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
                background: toast.type === 'warning' ? 'oklch(0.6 0.12 20 / 0.1)' : 'oklch(0.5 0.15 150 / 0.1)',
                color: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
              }}
            >
              {toast.message}
            </div>
          )}

          {error && (
            <div className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <div className="flex items-center justify-between">
                <p style={{ color: 'var(--error)' }}>{error}</p>
                <button onClick={clearError} className="font-medium hover:text-[var(--ink)] cursor-pointer" style={{ color: 'var(--muted)' }}>关闭</button>
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        {activeSheetName !== null && activeFileIdx !== null ? (
          <div className="flex-1 p-6 space-y-6 min-h-0">
            {/* Workspace Header */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  Excel 数据源 / {activeSel?.file.name}
                </div>
                <h2 className="text-base font-semibold mt-0.5 flex items-center gap-2">
                  <Table className="h-4 w-4" style={{ color: 'var(--primary)' }} />
                  {activeSheetName}
                  <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
                    ({activeSheet?.rowCount} 行 · {activeSheet?.columnCount} 列)
                  </span>
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <Tooltip
                  text={isActiveSheetSelected ? '取消当前 Sheet 的上下文选择' : '将当前 Sheet 加入上下文'}
                  side="bottom"
                >
                  <button
                    onClick={() => handleSheetToggle(activeFileIdx, activeSheetName)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer border ${
                      isActiveSheetSelected
                        ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {isActiveSheetSelected && <Check className="h-3.5 w-3.5" />}
                    {isActiveSheetSelected ? '已选 Sheet' : 'Sheet 选择'}
                  </button>
                </Tooltip>

                <Tooltip text="加载选中的 Sheet 到 AI Agent 上下文" side="bottom">
                  <button
                    onClick={handleLoadToContext}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
                    style={{ background: 'var(--primary)' }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    加载
                  </button>
                </Tooltip>

                <Tooltip text="清空 Agent 上下文与消息" side="bottom">
                  <button
                    onClick={() => {
                      useExcelStore.getState().clearAllContext();
                      clearMessages();
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    清空
                  </button>
                </Tooltip>

                <Tooltip text="将前 3 行样例数据加入上下文" side="bottom">
                  <label
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer select-none border transition-all duration-150"
                    style={{
                      borderColor: 'var(--border)',
                      color: includeSampleData ? 'var(--primary)' : 'var(--muted)',
                      background: includeSampleData ? 'var(--primary-glow)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={includeSampleData}
                      onChange={(e) => setIncludeSampleData(e.target.checked)}
                      className="h-3 w-3 accent-[var(--primary)] cursor-pointer"
                    />
                    样例数据
                  </label>
                </Tooltip>
              </div>
            </div>

            {/* Column Configuration Section */}
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                选择包含列
              </h3>
              {activeSheetColumns.length > 0 ? (
                <ColumnSelector
                  columns={activeSheetColumns}
                  selected={activeSheetSelectedColumns}
                  onChange={(cols) => selectColumns(activeFileIdx, activeSheetName, cols)}
                />
              ) : (
                <div className="py-4 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  正在读取列信息...
                </div>
              )}
            </div>

            {/* Data Preview Section */}
            {activeSheetPreviewData ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  数据预览
                </h3>
                <ExcelTable
                  data={activeSheetPreviewData}
                  selectedColumns={activeSheetSelectedColumns.length > 0 ? activeSheetSelectedColumns : undefined}
                />
              </div>
            ) : (
              <div className="py-12 border border-dashed rounded-lg flex flex-col items-center justify-center" style={{ borderColor: 'var(--border)' }}>
                <div className="h-6 w-6 animate-spin rounded-full border border-[var(--primary)] border-t-transparent mb-2" />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>正在加载数据预览...</span>
              </div>
            )}
          </div>
        ) : (
          /* Empty Workspace */
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <Table className="h-12 w-12 mb-3" style={{ color: 'var(--muted)' }} />
            <h3 className="text-sm font-medium mb-1">选择 Sheet 开始配置</h3>
            <p className="text-xs text-center max-w-xs" style={{ color: 'var(--muted)' }}>
              点击左侧列表中的 Sheet 进行聚焦，以选择包含的列并查看数据预览。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
