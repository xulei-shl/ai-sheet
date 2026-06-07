import { useEffect, useState } from 'react';
import { Clock, History, Play, Sigma, Eye, FileSpreadsheet, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { getColumnData, applyExcelFormula, getFormulaHistory, saveFormulaCache } from '../services/tauri';
import { ExcelTable } from '../components/excel/ExcelTable';
import type { PreviewData, ApplyFormulaRequest } from '../types/excel';
import type { FormulaCacheEntry } from '../types/formula';

export function FormulaPage() {
  const { files, selections } = useExcelStore();
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [selectedColumn, setSelectedColumn] = useState('');
  const [formula, setFormula] = useState('');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<FormulaCacheEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    getFormulaHistory().then(setHistoryEntries).catch(() => {});
  }, []);

  const currentFile = files[selectedFileIdx];
  const currentSel = selections[selectedFileIdx];
  const sheets = currentSel?.sheetInfo ?? [];
  const columns = selectedSheet ? (currentSel?.columnInfo[selectedSheet] ?? []) : [];

  const handlePreview = async () => {
    if (!currentFile || !selectedSheet || !selectedColumn || !formula) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const data = await getColumnData(currentFile.path, selectedSheet, [selectedColumn]);
      const colLabel = `${selectedColumn}(公式结果)`;
      const previewRows: Record<string, string>[] = data.rows.slice(0, 3).map((row: string[], i: number) => ({
        [selectedColumn]: row[0],
        [colLabel]: `= ${formula.replace(/\{\}/g, String(i + 2))}`,
      }));
      const preview: PreviewData = {
        columns: [...data.columns, colLabel],
        rows: previewRows,
        totalRows: data.rows.length,
      };
      setPreviewData(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApply = async () => {
    if (!currentFile || !selectedSheet || !selectedColumn || !formula) return;
    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const req: ApplyFormulaRequest = {
        path: currentFile.path,
        sheet: selectedSheet,
        column: selectedColumn,
        formula,
      };
      await applyExcelFormula(req);
      setSuccess(`公式已成功应用到 ${selectedColumn} 列`);

      // Auto-save to formula cache
      const columnsKey = `${selectedSheet}:${selectedColumn}`;
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
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-3">
            <Sigma className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            <h2 className="text-lg font-semibold">公式批量应用</h2>
          </div>

          {/* File/Sheet/Column Selection */}
          <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="grid grid-cols-3 gap-4">
              {/* File Select */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Excel 文件</label>
                {files.length > 0 ? (
                  <select
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={selectedFileIdx}
                    onChange={(e) => { setSelectedFileIdx(Number(e.target.value)); setSelectedSheet(''); setSelectedColumn(''); setPreviewData(null); }}
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

              {/* Sheet Select */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Sheet</label>
                <select
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={selectedSheet}
                  onChange={(e) => { setSelectedSheet(e.target.value); setSelectedColumn(''); setPreviewData(null); }}
                  disabled={sheets.length === 0}
                >
                  <option value="">选择 Sheet</option>
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>{s.name} ({s.rowCount}行)</option>
                  ))}
                </select>
              </div>

              {/* Column Select */}
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>目标列</label>
                <select
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={selectedColumn}
                  onChange={(e) => { setSelectedColumn(e.target.value); setPreviewData(null); }}
                  disabled={columns.length === 0}
                >
                  <option value="">选择列</option>
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Formula Input */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>公式</label>
              <textarea
                className="w-full resize-none rounded-md px-3 py-2 text-sm font-mono"
                rows={3}
                placeholder={'=CONCAT(A{}, B{})\n=UPPER(A{})\n支持 {} 作为行号占位符'}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePreview}
                disabled={!currentFile || !selectedSheet || !selectedColumn || !formula || previewLoading}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <Eye className="h-4 w-4" />
                {previewLoading ? '预览中...' : '预览前 3 行'}
              </button>
              <button
                onClick={handleApply}
                disabled={!currentFile || !selectedSheet || !selectedColumn || !formula || applying}
                className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Play className="h-4 w-4" />
                {applying ? '应用中...' : '应用公式'}
              </button>
              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                disabled={historyEntries.length === 0}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <History className="h-4 w-4" />
                从历史加载 ({historyEntries.length})
              </button>
            </div>

            {/* Formula History Dropdown */}
            {historyExpanded && historyEntries.length > 0 && (
              <div className="rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <div className="max-h-48 overflow-auto">
                  {historyEntries.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => { setFormula(entry.formula); setHistoryExpanded(false); }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink)' }}
                    >
                      <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--muted)' }} />
                      <div className="min-w-0 flex-1">
                        <code className="block truncate font-mono text-xs">{entry.formula}</code>
                        <span className="mt-0.5 block text-xs" style={{ color: 'var(--muted)' }}>
                          {entry.columnsKey} · {new Date(entry.accessedAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <AlertCircle className="h-4 w-4" style={{ color: 'var(--error)' }} />
              <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-sm" style={{ color: 'var(--muted)' }}>关闭</button>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'oklch(0.65 0.1 150)', background: 'oklch(0.65 0.1 150 / 0.1)', color: 'var(--success)' }}>
              {success}
            </div>
          )}

          {/* Preview */}
          {previewData && <ExcelTable data={previewData} maxRows={3} />}

          {/* Empty State */}
          {files.length === 0 && (
            <div className="py-16 text-center">
              <FileSpreadsheet className="mx-auto mb-4 h-12 w-12" style={{ color: 'var(--muted)' }} />
              <h3 className="mb-1 text-base font-medium">请先上传 Excel 文件</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>在左侧"数据"页面上传后，即可在此处应用公式</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
