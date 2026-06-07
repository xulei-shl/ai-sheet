import type { PreviewData } from '../../types/excel';

interface ExcelTableProps {
  data: PreviewData;
  maxRows?: number;
  selectedColumns?: string[];
}

function getColumnWidth(header: string, values: string[]): number {
  const maxLen = Math.max(header.length, ...values.map((v) => v.length));
  const minWidth = Math.max(maxLen * 8 + 24, 80);
  return Math.min(minWidth, 250);
}

export function ExcelTable({ data, maxRows = 10, selectedColumns }: ExcelTableProps) {
  const displayColumns = selectedColumns && selectedColumns.length > 0
    ? selectedColumns
    : data.columns;

  const rows = data.rows.slice(0, maxRows);

  const columnWidths = displayColumns.map((col) => {
    const cellValues = rows.map((row) => String(row[col] ?? ''));
    return getColumnWidth(col, cellValues);
  });

  const tableMinWidth = columnWidths.reduce((sum, w) => sum + w, 0);

  return (
    <div className="overflow-auto rounded-lg border max-h-80" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      <table className="text-xs w-full" style={{ minWidth: Math.max(tableMinWidth, 600), tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th 
              className="sticky top-0 z-10 px-3 py-2 text-left font-semibold border-b border-r" 
              style={{ 
                color: 'var(--muted)', 
                background: 'var(--surface)',
                borderColor: 'var(--border)',
                width: 50 
              }}
            >
              #
            </th>
            {displayColumns.map((col, ci) => (
              <th
                key={col}
                className="sticky top-0 z-10 px-3 py-2 text-left font-medium border-b border-r last:border-r-0 truncate"
                style={{ 
                  color: 'var(--ink)', 
                  background: 'var(--surface)',
                  borderColor: 'var(--border)',
                  width: columnWidths[ci] 
                }}
                title={col}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="transition-colors hover:bg-[var(--surface-hover)]"
              style={{ 
                background: i % 2 === 0 ? 'transparent' : 'var(--surface)',
                opacity: 0.95
              }}
            >
              <td 
                className="px-3 py-1.5 text-xs border-r border-b" 
                style={{ 
                  color: 'var(--muted)', 
                  borderColor: 'var(--border)', 
                  width: 50 
                }}
              >
                {i + 1}
              </td>
              {displayColumns.map((col, ci) => (
                <td 
                  key={col} 
                  className="truncate px-3 py-1.5 border-r border-b last:border-r-0" 
                  style={{ 
                    width: columnWidths[ci], 
                    borderColor: 'var(--border)', 
                    color: 'var(--ink)' 
                  }}
                  title={row[col] ?? ''}
                >
                  {row[col] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div 
        className="sticky bottom-0 z-10 px-3 py-2 text-xs flex justify-between border-t" 
        style={{ 
          color: 'var(--muted)', 
          background: 'var(--surface)', 
          borderColor: 'var(--border)' 
        }}
      >
        <span>
          {selectedColumns && selectedColumns.length > 0
            ? `已选 ${selectedColumns.length} 列`
            : `全部 ${data.columns.length} 列`}
        </span>
        {data.totalRows > maxRows && (
          <span>共 {data.totalRows} 行，显示前 {maxRows} 行</span>
        )}
      </div>
    </div>
  );
}

