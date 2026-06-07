import { useState, type DragEvent } from 'react';
import { FileSpreadsheet, Upload, X, Table, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useExcelStore } from '../stores/excelStore';
import { getColumnNames } from '../services/tauri';
import { ExcelTable } from '../components/excel/ExcelTable';
import { ColumnSelector } from '../components/excel/ColumnSelector';

export function DataPage() {
  const { files, selections, loading, error, addFile, removeFile, selectSheets, selectColumns, loadPreview, notifyContextChange, clearError } = useExcelStore();
  const [dragging, setDragging] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<number[]>([0]);
  const [toast, setToast] = useState<{ type: 'warning' | 'success'; message: string } | null>(null);

  const showToast = (type: 'warning' | 'success', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

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

  const handleSheetToggle = async (fileIndex: number, sheet: string) => {
    const sel = selections[fileIndex];
    if (!sel) return;
    const isSelected = sel.selectedSheets.includes(sheet);

    if (!isSelected) {
      if (!sel.columnInfo[sheet]) {
        try {
          const cols = await getColumnNames(sel.file.path, sheet);
          useExcelStore.setState((s) => {
            const updated = [...s.selections];
            updated[fileIndex] = {
              ...updated[fileIndex],
              columnInfo: { ...updated[fileIndex].columnInfo, [sheet]: cols },
            };
            return { selections: updated };
          });
        } catch {
          // ignore
        }
      }
      await loadPreview(fileIndex, sheet);
    }

    const newSheets = isSelected
      ? sel.selectedSheets.filter((s) => s !== sheet)
      : [...sel.selectedSheets, sheet];
    await selectSheets(fileIndex, newSheets);
  };

  const handleColumnToggle = (fileIndex: number, sheet: string, col: string) => {
    const sel = selections[fileIndex];
    if (!sel) return;
    const current = sel.selectedColumns[sheet] || [];
    const next = current.includes(col)
      ? current.filter((c) => c !== col)
      : [...current, col];
    selectColumns(fileIndex, sheet, next);
  };

  const handleLoadToContext = () => {
    if (!selections.some((s) => s.selectedSheets.length > 0)) {
      showToast('warning', '请先选择 Sheet');
      return;
    }
    notifyContextChange();
    showToast('success', '已加载到 AI Agent 上下文');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">数据加载</h2>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>上传 Excel 文件，选择 Sheet 和列</p>
            </div>
            <button
              onClick={handleLoadToContext}
              disabled={files.length === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
              style={{ background: 'var(--primary)' }}
            >
              <Check className="h-4 w-4" />
              加载到上下文
            </button>
          </div>

          {/* Toast */}
          {toast && (
            <div
              className="rounded-lg border p-3 text-sm"
              style={{
                borderColor: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
                background: toast.type === 'warning' ? 'oklch(0.6 0.12 20 / 0.1)' : 'oklch(0.5 0.15 150 / 0.1)',
                color: toast.type === 'warning' ? 'var(--error)' : 'var(--primary)',
              }}
            >
              {toast.message}
            </div>
          )}

          {/* File Drop Zone */}
          <div
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragging
                ? 'border-[var(--primary)] bg-[var(--primary-glow)]'
                : 'border-[var(--border)] hover:border-[var(--primary)]'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClickOpen}
            role="button"
            tabIndex={0}
          >
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--primary-glow)' }}>
              {dragging ? <Upload className="h-7 w-7" style={{ color: 'var(--primary)' }} /> : <FileSpreadsheet className="h-7 w-7" style={{ color: 'var(--primary)' }} />}
            </div>
            <p className="mb-1 font-medium">拖放 Excel 文件到此处</p>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>或点击此区域选择文件</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>支持 .xlsx / .xls 格式</p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
                <button onClick={clearError} className="text-sm" style={{ color: 'var(--muted)' }}>关闭</button>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-3 py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
              <span className="text-sm" style={{ color: 'var(--muted)' }}>处理中...</span>
            </div>
          )}

          {/* File List */}
          {files.map((file, fi) => {
            const sel = selections[fi];
            const isExpanded = expandedFiles.includes(fi);
            return (
              <div key={fi} className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                {/* File Header */}
                <div
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
                  style={{ background: 'var(--surface)' }}
                  onClick={() => toggleExpand(fi)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4" style={{ color: 'var(--muted)' }} /> : <ChevronRight className="h-4 w-4" style={{ color: 'var(--muted)' }} />}
                    <FileSpreadsheet className="h-5 w-5" style={{ color: 'var(--primary)' }} />
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {(file.size / 1024).toFixed(1)} KB · {sel?.sheetInfo.length ?? 0} 个 Sheet
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(fi); }}
                    className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--muted)' }}
                    title="移除文件"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Expanded Content */}
                {isExpanded && sel && (
                  <div className="border-t p-4 space-y-6" style={{ borderColor: 'var(--border)' }}>
                    {sel.sheetInfo.map((sheet) => {
                      const isSheetSelected = sel.selectedSheets.includes(sheet.name);
                      const sheetColumns = sel.columnInfo[sheet.name] || [];
                      const sheetSelectedColumns = sel.selectedColumns[sheet.name] || [];
                      const sheetPreviewData = sel.previewData[sheet.name] || null;

                      return (
                        <div key={sheet.name} className="space-y-3">
                          {/* Sheet Header */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSheetToggle(fi, sheet.name)}
                              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                isSheetSelected
                                  ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--primary)]'
                                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)]'
                              }`}
                            >
                              <Table className="h-3.5 w-3.5" />
                              {sheet.name}
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                                ({sheet.rowCount}行)
                              </span>
                            </button>
                          </div>

                          {/* Column Selector + Preview */}
                          {isSheetSelected && (
                            <div className="space-y-3 pl-2">
                              {sheetColumns.length > 0 && (
                                <div>
                                  <p className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>选择列</p>
                                  <ColumnSelector
                                    columns={sheetColumns}
                                    selected={sheetSelectedColumns}
                                    onChange={(cols) => selectColumns(fi, sheet.name, cols)}
                                  />
                                </div>
                              )}
                              {sheetPreviewData && (
                                <div>
                                  <p className="mb-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>数据预览</p>
                                  <ExcelTable
                                    data={sheetPreviewData}
                                    selectedColumns={sheetSelectedColumns.length > 0 ? sheetSelectedColumns : undefined}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty State */}
          {files.length === 0 && !loading && (
            <div className="py-16 text-center">
              <Table className="mx-auto mb-4 h-12 w-12" style={{ color: 'var(--muted)' }} />
              <h3 className="mb-1 text-base font-medium">暂无数据</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>请先上传 Excel 文件开始使用</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
