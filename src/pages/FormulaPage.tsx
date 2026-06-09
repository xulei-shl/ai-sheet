import { useEffect, useState, useRef } from 'react';
import { Clock, History, Play, Sigma, Eye, FileSpreadsheet, AlertCircle, ChevronDown, ChevronRight, Table, Lightbulb, WandSparkles, Pin, X } from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { getColumnNames, applyExcelFormula, getFormulaHistory, saveFormulaCache, getPinnedFormulas, addPinnedFormula, deletePinnedFormula, previewFormula } from '../services/tauri';
import { ExcelTable } from '../components/excel/ExcelTable';
import { SearchableSelect } from '../components/excel/SearchableSelect';
import type { PreviewData, ApplyFormulaRequest } from '../types/excel';
import type { FormulaCacheEntry, PinnedFormula } from '../types/formula';
import type { ColumnInfo } from '../types/excel';

export function FormulaPage() {
  const { files, selections } = useExcelStore();
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [strategy, setStrategy] = useState<'overwrite' | 'append'>('overwrite');
  const [selectedColumn, setSelectedColumn] = useState('');
  const [newColumnName, setNewColumnName] = useState('');
  const [formula, setFormula] = useState('');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<FormulaCacheEntry[]>([]);
  const [pinnedFormulas, setPinnedFormulas] = useState<PinnedFormula[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<number[]>([0]);
  const [pinDialog, setPinDialog] = useState<{ open: boolean; formula: string; columnsKey: string }>({ open: false, formula: '', columnsKey: '' });
  const [pinName, setPinName] = useState('');
  const pinInputRef = useRef<HTMLInputElement>(null);

  const loadPinnedFormulas = () => {
    getPinnedFormulas().then(setPinnedFormulas).catch(() => {});
  };

  useEffect(() => {
    getFormulaHistory().then(setHistoryEntries).catch(() => {});
    loadPinnedFormulas();
  }, []);

  useEffect(() => {
    if (files.length > 0 && !selectedSheet) {
      const idx = selections.findIndex((s) => s.sheetInfo.length > 0);
      const selIdx = idx >= 0 ? idx : 0;
      const sel = selections[selIdx];
      if (sel && sel.sheetInfo.length > 0) {
        handleFocusSheet(selIdx, sel.sheetInfo[0].name);
      }
    }
  }, [files]);

  useEffect(() => {
    if (!selectedSheet || !currentFile) return;
    if (currentSel?.columnInfo[selectedSheet]) return;
    setColumnsLoading(true);
    getColumnNames(currentFile.path, selectedSheet)
      .then((cols) => {
        useExcelStore.setState((s) => {
          const updated = [...s.selections];
          updated[selectedFileIdx] = {
            ...updated[selectedFileIdx],
            columnInfo: { ...updated[selectedFileIdx].columnInfo, [selectedSheet]: cols },
          };
          return { selections: updated };
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setColumnsLoading(false));
  }, [selectedSheet, selectedFileIdx]);

  const currentFile = files[selectedFileIdx];
  const currentSel = selections[selectedFileIdx];
  const sheets = currentSel?.sheetInfo ?? [];
  const columns: ColumnInfo[] = selectedSheet ? (currentSel?.columnInfo[selectedSheet] ?? []) : [];
  const effectiveColumn = strategy === 'overwrite' ? selectedColumn : newColumnName;

  const handleFocusSheet = (fileIdx: number, sheetName: string) => {
    setSelectedFileIdx(fileIdx);
    setSelectedSheet(sheetName);
    setSelectedColumn('');
    setNewColumnName('');
    setPreviewData(null);
    setError(null);
    setSuccess(null);
  };

  const toggleExpand = (idx: number) => {
    setExpandedFiles((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handlePreview = async () => {
    if (!currentFile || !selectedSheet || !effectiveColumn || !formula) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const colLabel = `${effectiveColumn}(公式结果)`;
      if (strategy === 'overwrite' && columns.some((c) => c.name === selectedColumn)) {
        const result = await previewFormula(currentFile.path, selectedSheet, [selectedColumn], 3);
        const previewRows: Record<string, string>[] = result.rows.map((row, i) => {
          const raw = row[0];
          const fText = result.formulas[i]?.[0];
          const displayVal = fText ? `Formula: ${fText}` : raw;
          return {
            [selectedColumn]: displayVal,
            [colLabel]: formula.replace(/\{\}/g, String(i + 2)),
          };
        });
        setPreviewData({
          columns: [selectedColumn, colLabel],
          rows: previewRows,
          totalRows: result.totalRows,
        });
      } else {
        const rows = sheets.find((s) => s.name === selectedSheet);
        const totalRows = rows?.rowCount ?? 0;
        setPreviewData({
          columns: [colLabel],
          rows: Array.from({ length: Math.min(3, totalRows) }, (_, i) => ({
            [colLabel]: formula.replace(/\{\}/g, String(i + 2)),
          })),
          totalRows,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePinSubmit = async () => {
    if (!pinName.trim()) return;
    try {
      await addPinnedFormula(pinName.trim(), pinDialog.formula, pinDialog.columnsKey);
      setPinDialog({ open: false, formula: '', columnsKey: '' });
      setPinName('');
      loadPinnedFormulas();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePinDelete = async (id: number) => {
    try {
      await deletePinnedFormula(id);
      loadPinnedFormulas();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApply = async () => {
    if (!currentFile || !selectedSheet || !effectiveColumn || !formula) return;
    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const req: ApplyFormulaRequest = {
        path: currentFile.path,
        sheet: selectedSheet,
        column: effectiveColumn,
        formula,
        strategy,
      };
      await applyExcelFormula(req);
      setSuccess(`公式已成功应用到 ${effectiveColumn} 列`);

      const columnsKey = `${selectedSheet}:${effectiveColumn}`;
      saveFormulaCache(formula, columnsKey, formula).catch(() => {});
      getFormulaHistory().then(setHistoryEntries).catch(() => {});

      setFormula('');
      setPreviewData(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)]">
      {/* Left Sidebar: File Tree */}
      <div 
        className="w-72 shrink-0 border-r flex flex-col overflow-hidden" 
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>选择工作表</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {files.map((file, fi) => {
            const sel = selections[fi];
            const isExpanded = expandedFiles.includes(fi);
            return (
              <div key={fi} className="space-y-1">
                <div 
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                  onClick={() => toggleExpand(fi)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                  )}
                  <FileSpreadsheet className="h-4 w-4 shrink-0" style={{ color: 'var(--primary)' }} />
                  <span className="text-xs font-medium truncate flex-1" title={file.name}>{file.name}</span>
                </div>

                {isExpanded && sel && (
                  <div className="pl-4 space-y-0.5">
                    {sel.sheetInfo.map((sheet) => {
                      const isSheetFocused = selectedFileIdx === fi && selectedSheet === sheet.name;
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
                          <Table className="h-3.5 w-3.5 shrink-0" style={{ color: isSheetFocused ? 'var(--primary)' : 'var(--muted)' }} />
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
          {files.length === 0 && (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
              请先在"数据"页面导入文件
            </div>
          )}
        </div>

        {/* Pinned Formulas (bottom of sidebar) */}
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>快捷公式</span>
          </div>
          {pinnedFormulas.length > 0 ? (
            <div className="space-y-1">
              {pinnedFormulas.map((pf) => (
                <div
                  key={pf.id}
                  className="group relative flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                  style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
                  onClick={() => setFormula(pf.formula)}
                  title={pf.formula}
                >
                  <WandSparkles className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--primary)' }} />
                  <span className="truncate flex-1">{pf.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePinDelete(pf.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                    title="删除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-[10px]" style={{ color: 'var(--muted)' }}>
              暂无固定公式<br/>在历史记录中点击 <Pin className="inline h-2.5 w-2.5" /> 固定
            </div>
          )}
        </div>
      </div>

      {/* Right Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {selectedSheet && currentFile ? (
          <>
            {/* Workspace Header */}
            <div className="p-4 pb-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                公式处理 / {currentFile.name}
              </div>
              <h2 className="text-base font-semibold mt-0.5 flex items-center gap-2">
                <Table className="h-4 w-4" style={{ color: 'var(--primary)' }} />
                {selectedSheet}
                <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
                  ({sheets.find((s) => s.name === selectedSheet)?.rowCount} 行)
                </span>
              </h2>
            </div>

            {/* Error & Success Messages */}
            {error && (
              <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border p-3 text-xs shrink-0" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
                <AlertCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--error)' }} />
                <span style={{ color: 'var(--error)' }}>{error}</span>
                <button onClick={() => setError(null)} className="ml-auto text-xs font-medium hover:text-[var(--ink)] cursor-pointer" style={{ color: 'var(--muted)' }}>关闭</button>
              </div>
            )}
            {success && (
              <div className="mx-4 mt-3 rounded-lg border p-3 text-xs shrink-0" style={{ borderColor: 'oklch(0.65 0.1 150)', background: 'oklch(0.65 0.1 150 / 0.1)', color: 'var(--success)' }}>
                {success}
              </div>
            )}

            {/* Top: Config Side-by-Side */}
            <div className="shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 pb-0">
              {/* Left: Formula Editor + Target Column */}
              <div className="space-y-3">
                {/* Strategy & Target Column */}
                <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>目标列设置</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setStrategy('overwrite'); setSelectedColumn(''); setNewColumnName(''); setPreviewData(null); }}
                      className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer border"
                      style={{
                        background: strategy === 'overwrite' ? 'var(--primary)' : 'var(--bg)',
                        color: strategy === 'overwrite' ? 'var(--primary-foreground)' : 'var(--muted)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      覆盖现有列
                    </button>
                    <button
                      onClick={() => { setStrategy('append'); setSelectedColumn(''); setNewColumnName(''); setPreviewData(null); }}
                      className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer border"
                      style={{
                        background: strategy === 'append' ? 'var(--primary)' : 'var(--bg)',
                        color: strategy === 'append' ? 'var(--primary-foreground)' : 'var(--muted)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      新增列
                    </button>
                  </div>

                  {strategy === 'overwrite' ? (
                    <div>
                      {columnsLoading ? (
                        <div className="py-4 text-center text-xs" style={{ color: 'var(--muted)' }}>加载列中...</div>
                      ) : columns.length > 0 ? (
                        <SearchableSelect
                          options={columns.map((c) => ({ value: c.name, label: c.name }))}
                          value={selectedColumn}
                          onChange={(v) => { setSelectedColumn(typeof v === 'string' ? v : ''); setPreviewData(null); }}
                          mode="single"
                          placeholder="选择目标列..."
                          searchPlaceholder="搜索列名..."
                        />
                      ) : (
                        <div className="py-4 text-center text-xs" style={{ color: 'var(--muted)' }}>未找到列信息</div>
                      )}
                    </div>
                  ) : (
                    <input
                      className="h-9 w-full rounded-md px-3 text-sm focus-visible:outline-[var(--primary)]"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      placeholder="输入新列名称"
                      value={newColumnName}
                      onChange={(e) => { setNewColumnName(e.target.value); setPreviewData(null); }}
                    />
                  )}
                </div>

                {/* Formula Input */}
                <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>输入公式</h3>
                  <textarea
                    className="w-full resize-none rounded-md px-3 py-2 text-xs font-mono focus-visible:outline-[var(--primary)]"
                    rows={3}
                    placeholder={'=CONCAT(A{}, B{})\n=UPPER(A{})\n支持 {} 作为当前行号占位符'}
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handlePreview}
                      disabled={!effectiveColumn || !formula || previewLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50 cursor-pointer"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {previewLoading ? '预览中...' : '预览前 3 行'}
                    </button>
                    <button
                      onClick={handleApply}
                      disabled={!effectiveColumn || !formula || applying}
                      className="inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {applying ? '应用中...' : '应用公式'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: History */}
              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                  <History className="h-3.5 w-3.5" />
                  公式历史记录
                </h3>
                {historyEntries.length > 0 ? (
                  <div className="rounded-lg border overflow-y-auto max-h-52 divide-y divide-[var(--border)]" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    {historyEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="group flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--surface-hover)]"
                        style={{ color: 'var(--ink)' }}
                      >
                        <button
                          onClick={() => { setFormula(entry.formula); }}
                          className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer text-left"
                        >
                          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                          <div className="min-w-0 flex-1">
                            <code className="block truncate font-mono text-[10px]" style={{ color: 'var(--primary)' }}>{entry.formula}</code>
                            <span className="mt-0.5 block text-[9px]" style={{ color: 'var(--muted)' }}>
                              {entry.columnsKey}
                            </span>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            const name = entry.formula.match(/^=(\w+)\(/)?.[1] ?? '公式';
                            setPinName(name);
                            setPinDialog({ open: true, formula: entry.formula, columnsKey: entry.columnsKey });
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-[var(--surface-hover)] cursor-pointer mt-0.5"
                          style={{ color: 'var(--muted)' }}
                          title="固定到快捷公式"
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-32 border border-dashed rounded-lg flex items-center justify-center text-xs text-center p-4" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    暂无历史公式记录<br/>应用公式后历史将显示在此处
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Always-visible Preview Table */}
            <div className="flex-1 flex flex-col min-h-0 p-4 pt-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2 shrink-0" style={{ color: 'var(--muted)' }}>预览结果</h3>
              <div className="flex-1 min-h-0 border rounded-lg overflow-auto" style={{ borderColor: 'var(--border)' }}>
                {previewData ? (
                  <ExcelTable data={previewData} maxRows={3} />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
                    输入公式及目标列，点击"预览前 3 行"查看结果
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <Sigma className="h-12 w-12 mb-3" style={{ color: 'var(--muted)' }} />
            <h3 className="text-sm font-medium mb-1">选择 Sheet 开始应用公式</h3>
            <p className="text-xs text-center max-w-xs" style={{ color: 'var(--muted)' }}>
              请在左侧列表中点击聚焦任意 Sheet 以输入公式，并批量应用至目标列。
            </p>
          </div>
        )}
      </div>
    </div>

    {/* Pin Dialog */}
    {pinDialog.open && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={() => { setPinDialog({ open: false, formula: '', columnsKey: '' }); setPinName(''); }}
      >
        <div
          className="w-80 rounded-lg border p-4 shadow-xl"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--ink)' }}>固定公式</h3>
          <code className="block truncate font-mono text-[10px] mb-3 p-2 rounded" style={{ background: 'var(--bg)', color: 'var(--primary)', border: '1px solid var(--border)' }}>
            {pinDialog.formula}
          </code>
          <input
            ref={pinInputRef}
            className="h-9 w-full rounded-md px-3 text-xs mb-3 focus-visible:outline-[var(--primary)]"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            placeholder="输入快捷公式名称"
            value={pinName}
            onChange={(e) => setPinName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePinSubmit(); }}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setPinDialog({ open: false, formula: '', columnsKey: '' }); setPinName(''); }}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-hover)] cursor-pointer"
              style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              取消
            </button>
            <button
              onClick={handlePinSubmit}
              disabled={!pinName.trim()}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
