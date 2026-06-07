import { useState, useEffect } from 'react';
import { FileCode, Terminal, FileSpreadsheet, AlertCircle, Play, Sparkles } from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { SearchableSelect } from '../components/excel/SearchableSelect';

export function PythonProcessingPage() {
  const { files, selections } = useExcelStore();
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [script, setScript] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFile = files[selectedFileIdx];
  const currentSel = selections[selectedFileIdx];
  const sheets = currentSel?.sheetInfo ?? [];

  useEffect(() => {
    if (files.length > 0 && !selectedSheet) {
      const idx = selections.findIndex((s) => s.sheetInfo.length > 0);
      const selIdx = idx >= 0 ? idx : 0;
      const sel = selections[selIdx];
      if (sel && sel.sheetInfo.length > 0) {
        setSelectedFileIdx(selIdx);
        setSelectedSheet(sel.sheetInfo[0].name);
      }
    }
  }, [files]);

  const generateTemplateScript = () => {
    if (!currentFile || !selectedSheet) return;
    setScript(`import pandas as pd

# 读取 Excel 数据
df = pd.read_excel(r"${currentFile.path.replace(/\\/g, '\\\\')}", sheet_name="${selectedSheet}")

# 查看数据基本信息
print("数据形状:", df.shape)
print("列名:", list(df.columns))
print("\\n前5行数据:")
print(df.head())

# TODO: 在此处添加你的数据处理逻辑
# 示例: df['新列'] = df['旧列'].apply(lambda x: x.upper())
`);
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setOutput(null);

    const lines: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    console.error = (...args) => { lines.push(`[ERROR] ${args.map(String).join(' ')}`); };

    try {
      const asyncFn = AsyncFunction('__filename', '__sheetname', script);
      const result = await asyncFn(currentFile?.path ?? '', selectedSheet);
      if (result !== undefined) {
        lines.push(`返回值: ${String(result)}`);
      }
      setOutput(lines.join('\n') || '脚本执行完成（无输出）');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOutput(lines.join('\n'));
    } finally {
      console.log = originalLog;
      console.error = originalError;
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)] divide-x divide-[var(--border)]">
      {/* Left Column: Script Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-[360px]">
        {/* Compact header toolbar */}
        <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <FileCode className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
              Python 脚本
            </span>
            {currentFile && selectedSheet && (
              <button
                onClick={generateTemplateScript}
                className="flex items-center gap-1 text-[10px] hover:text-[var(--ink)] cursor-pointer"
                style={{ color: 'var(--primary)' }}
              >
                <Sparkles className="h-3 w-3" />
                生成模板
              </button>
            )}
          </div>

          {/* Inline selectors */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[9px] font-medium shrink-0" style={{ color: 'var(--muted)' }}>文件</span>
              {files.length > 0 ? (
                <SearchableSelect
                  className="flex-1 min-w-0"
                  options={files.map((f, i) => ({ value: String(i), label: f.name }))}
                  value={String(selectedFileIdx)}
                  onChange={(v) => { setSelectedFileIdx(Number(v)); setSelectedSheet(''); }}
                  mode="single"
                  placeholder="选择文件"
                  searchPlaceholder="搜索文件..."
                />
              ) : (
                <div className="h-7 flex-1 flex items-center rounded px-2 text-[11px]" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                  暂无文件
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[9px] font-medium shrink-0" style={{ color: 'var(--muted)' }}>Sheet</span>
              <SearchableSelect
                className="flex-1 min-w-0"
                options={sheets.map((s) => ({ value: s.name, label: `${s.name} (${s.rowCount}行)` }))}
                value={selectedSheet}
                onChange={(v) => setSelectedSheet(typeof v === 'string' ? v : '')}
                mode="single"
                placeholder="选择"
                searchPlaceholder="搜索 Sheet..."
                disabled={sheets.length === 0}
              />
            </div>
          </div>
        </div>

        {/* Full-height script editor */}
        {currentFile ? (
          <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
            <div className="flex-1 flex flex-col border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center px-3 py-1 text-[9px] font-semibold border-b justify-between select-none" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
                <span>script.py</span>
                <span className="font-mono">pandas & openpyxl</span>
              </div>
              <textarea
                className="flex-1 w-full resize-none p-3 font-mono text-[11px] leading-relaxed focus-visible:outline-none select-text"
                placeholder={`# 导入 pandas 开始处理数据...\nimport pandas as pd\n\n# 点击"生成模板"自动填充`}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                style={{ background: 'var(--bg)', color: 'var(--ink)' }}
              />
            </div>
            
            <div className="flex items-center justify-end shrink-0">
              <button
                onClick={handleRun}
                disabled={!script.trim() || running}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                style={{ background: 'var(--primary)' }}
              >
                <Play className="h-3 w-3" />
                {running ? '执行中...' : '运行脚本'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <FileSpreadsheet className="h-12 w-12 mb-3" style={{ color: 'var(--muted)' }} />
            <h3 className="text-sm font-medium mb-1">请先上传 Excel 文件</h3>
            <p className="text-xs max-w-xs" style={{ color: 'var(--muted)' }}>
              在"数据"页面导入文件后，即可在此处编写并执行 Python 处理脚本。
            </p>
          </div>
        )}
      </div>

      {/* Right Column: Full-height Terminal Output */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-[360px]">
        <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Terminal className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
              控制台输出
            </span>
            {output !== null && (
              <button
                onClick={() => setOutput(null)}
                className="text-[10px] hover:text-[var(--ink)] cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                清空
              </button>
            )}
          </div>
        </div>

        <div 
          className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed space-y-3"
          style={{ background: '#0a0a0a' }}
        >
          {error && (
            <div className="flex items-start gap-2 text-red-400 border border-red-950 bg-red-950/20 rounded-md p-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs mb-1">脚本执行发生错误</p>
                <p className="break-all whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          )}

          {output !== null ? (
            <div className="text-slate-300">
              <p className="text-[9px] font-sans font-semibold mb-2 text-slate-500 border-b border-zinc-800 pb-1 select-none">STDOUT & LOGS</p>
              <pre className="break-all whitespace-pre-wrap">{output}</pre>
            </div>
          ) : !error && (
            <div className="h-full flex items-center justify-center text-xs opacity-35 select-none text-slate-500 font-sans">
              控制台输出为空，等待运行脚本...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AsyncFunction(...args: string[]): (...args: unknown[]) => Promise<unknown> {
  const AsyncFunctionConstructor = Object.getPrototypeOf(async () => {}).constructor as typeof Function;
  return new AsyncFunctionConstructor(...args) as (...args: unknown[]) => Promise<unknown>;
}
