import { useState } from 'react';
import { FileCode, Terminal, FileSpreadsheet, AlertCircle, Play } from 'lucide-react';
import { useExcelStore } from '../stores/excelStore';
import { getSampleData } from '../services/tauri';

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
      const AsyncFunctionConstructor = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
      const asyncFn = new AsyncFunctionConstructor('__filename', '__sheetname', script);
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
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <FileCode className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            <h2 className="text-lg font-semibold">Python 处理</h2>
          </div>

          {/* File/Sheet Selection */}
          <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Excel 文件</label>
                {files.length > 0 ? (
                  <select
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={selectedFileIdx}
                    onChange={(e) => { setSelectedFileIdx(Number(e.target.value)); setSelectedSheet(''); }}
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
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  disabled={sheets.length === 0}
                >
                  <option value="">选择 Sheet</option>
                  {sheets.map((s) => (
                    <option key={s.name} value={s.name}>{s.name} ({s.rowCount}行)</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Script Editor */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Python 脚本</label>
                {currentFile && selectedSheet && (
                  <button
                    onClick={generateTemplateScript}
                    className="text-xs underline"
                    style={{ color: 'var(--primary)' }}
                  >
                    生成模板
                  </button>
                )}
              </div>
              <textarea
                className="w-full resize-none rounded-md px-3 py-2 text-sm font-mono leading-relaxed"
                rows={12}
                placeholder={`import pandas as pd\n\n# 读取 Excel\npath = r"文件路径"\ndf = pd.read_excel(path, sheet_name="Sheet1")\n\n# 处理数据\nprint(df.head())`}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)', fontFamily: 'ui-monospace, monospace' }}
              />
            </div>

            {/* Actions */}
            <button
              onClick={handleRun}
              disabled={!script.trim() || running}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              <Play className="h-4 w-4" />
              {running ? '执行中...' : '执行脚本'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--error)', background: 'oklch(0.6 0.12 20 / 0.1)' }}>
              <AlertCircle className="h-4 w-4" style={{ color: 'var(--error)' }} />
              <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto text-sm" style={{ color: 'var(--muted)' }}>关闭</button>
            </div>
          )}

          {/* Output */}
          {output !== null && (
            <div className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <Terminal className="h-4 w-4" style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-medium">执行输出</span>
              </div>
              <pre className="max-h-80 overflow-auto p-4 text-sm font-mono leading-relaxed" style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
                {output}
              </pre>
            </div>
          )}

          {/* Hint */}
          {!currentFile && (
            <div className="py-16 text-center">
              <FileSpreadsheet className="mx-auto mb-4 h-12 w-12" style={{ color: 'var(--muted)' }} />
              <h3 className="mb-1 text-base font-medium">请先上传 Excel 文件</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>或在右栏通过 AI 对话生成 Python 处理脚本</p>
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
