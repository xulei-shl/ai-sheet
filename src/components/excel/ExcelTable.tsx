import type { PreviewData } from '../../types/excel';

interface ExcelTableProps {
  data: PreviewData;
  maxRows?: number;
  selectedColumns?: string[];
}

export function ExcelTable({ data, maxRows = 10, selectedColumns }: ExcelTableProps) {
  const displayColumns = selectedColumns && selectedColumns.length > 0
    ? selectedColumns
    : data.columns;

  const rows = data.rows.slice(0, maxRows);

  return (
    <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th className="w-10 px-3 py-2 text-left text-xs" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
              #
            </th>
            {displayColumns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left font-medium"
                style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}
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
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                {i + 1}
              </td>
              {displayColumns.map((col) => (
                <td key={col} className="max-w-[200px] truncate px-3 py-1.5">
                  {row[col] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-xs flex justify-between" style={{ color: 'var(--muted)', background: 'var(--surface)' }}>
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
