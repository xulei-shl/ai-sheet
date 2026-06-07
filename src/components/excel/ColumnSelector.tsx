import type { ColumnInfo } from '../../types/excel';

interface ColumnSelectorProps {
  columns: ColumnInfo[];
  selected: string[];
  onChange: (columns: string[]) => void;
}

export function ColumnSelector({ columns, selected, onChange }: ColumnSelectorProps) {
  const toggle = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((c) => c !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {columns.map((col) => {
        const isSelected = selected.includes(col.name);
        return (
          <button
            key={col.name}
            onClick={() => toggle(col.name)}
            className={`rounded-md border px-3 py-1 text-sm transition-colors ${
              isSelected
                ? 'border-[var(--primary)] bg-[var(--primary-glow)] text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)]'
            }`}
            aria-pressed={isSelected}
          >
            {col.name}
          </button>
        );
      })}
    </div>
  );
}
