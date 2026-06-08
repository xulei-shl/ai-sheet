import { FileSpreadsheet, Layers, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import type { AgentContext } from '../../types/agent';
import { useExcelStore } from '../../stores/excelStore';
import { useAgentStore } from '../../stores/agentStore';

interface ContextPreviewProps {
  context: AgentContext;
}

export function ContextPreview({ context }: ContextPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const clearAllContext = useExcelStore((s) => s.clearAllContext);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const handleClear = () => {
    clearAllContext();
    clearMessages();
  };

  const hasFiles = context.loadedFiles && context.loadedFiles.length > 0;

  if (!hasFiles) {
    return null;
  }

  const totalSheets = context.loadedFiles!.reduce((acc, f) => acc + f.sheets.length, 0);
  const totalColumns = context.loadedFiles!.reduce(
    (acc, f) => acc + f.sheets.reduce((s, sh) => s + sh.columns.length, 0),
    0,
  );
  const hasSampleData = context.sampleDataPreview !== undefined;

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex flex-1 items-center justify-between text-sm font-medium text-[var(--ink)] hover:text-[var(--primary)] transition-colors"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--primary)]" />
            <span>已加载上下文</span>
            <span className="text-xs text-[var(--muted)]">
              {context.loadedFiles!.length} 个文件 · {totalSheets} 个 Sheet · {totalColumns} 列{hasSampleData ? ' · 含样例' : ''}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleClear}
          className="flex-shrink-0 rounded p-1 text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
          aria-label="清空已加载的上下文"
          title="一键清空已选上下文"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mt-3 space-y-3 text-sm">
          {context.loadedFiles!.map((file, fileIdx) => (
            <div key={fileIdx}>
              <div className="flex items-center gap-2 mb-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--primary)] flex-shrink-0" />
                <span className="text-xs font-medium text-[var(--ink)]">{file.name}</span>
                <span className="text-[10px] truncate max-w-[200px]" style={{ color: 'var(--muted)' }} title={file.path}>{file.path}</span>
              </div>
              <div className="ml-5 space-y-1.5">
                {file.sheets.map((sheet, sheetIdx) => (
                  <div key={sheetIdx}>
                    <div className="text-xs text-[var(--muted)] mb-0.5">
                      Sheet: {sheet.sheetName}
                      {sheet.columns.length > 0 ? (
                        <span className="ml-1">({sheet.columns.length} 列)</span>
                      ) : (
                        <span className="ml-1 italic">（未选列）</span>
                      )}
                    </div>
                    {sheet.columns.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {sheet.columns.map((col, colIdx) => (
                          <span
                            key={colIdx}
                            className="inline-flex items-center rounded-md bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--ink-light)]"
                          >
                            {col.letter}({col.name})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
