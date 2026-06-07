import { useState } from 'react';
import { Search, Check } from 'lucide-react';
import type { ColumnInfo } from '../../types/excel';

interface ColumnSelectorProps {
  columns: ColumnInfo[];
  selected: string[];
  onChange: (columns: string[]) => void;
}

export function ColumnSelector({ columns, selected, onChange }: ColumnSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const toggle = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((c) => c !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  const handleSelectAll = () => {
    onChange(columns.map((c) => c.name));
  };

  const handleClear = () => {
    onChange([]);
  };

  const filteredColumns = columns.filter((col) =>
    col.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            placeholder="搜索列名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-md pl-8 pr-3 text-xs transition-colors focus-visible:outline-[var(--primary)]"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--ink)'
            }}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="rounded px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
            style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            清空
          </button>
        </div>
      </div>

      {/* Columns Grid - multi-select grid layout (DataPage style) */}
      {filteredColumns.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-48 overflow-y-auto p-0.5">
          {filteredColumns.map((col) => {
            const isSelected = selected.includes(col.name);
            return (
              <button
                key={col.name}
                type="button"
                onClick={() => toggle(col.name)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs text-left cursor-pointer transition-all duration-150 ${
                  isSelected
                    ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--ink)] font-medium'
                    : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)] bg-[var(--surface)]'
                }`}
                aria-pressed={isSelected}
              >
                {/* Custom Checkbox */}
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  isSelected
                    ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'border-[var(--border)] bg-transparent'
                }`}>
                  {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <span className="truncate flex-1">{col.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
          未找到匹配的列
        </div>
      )}
    </div>
  );
}
