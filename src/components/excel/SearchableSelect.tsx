import { useState, useRef, useEffect } from 'react';
import { Search, Check, ChevronDown, X } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  mode?: 'single' | 'multiple';
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Optional formatter for displaying selected value(s) in trigger */
  formatValue?: (selected: SearchableSelectOption[]) => string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  mode = 'single',
  placeholder = '请选择...',
  searchPlaceholder = '搜索...',
  emptyText = '未找到匹配项',
  disabled = false,
  className = '',
  formatValue,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
  const selectedOptions = options.filter((o) => selectedValues.includes(o.value));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      // Small delay to ensure the input is mounted
      const t = setTimeout(() => searchInputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelect = (optValue: string) => {
    if (mode === 'single') {
      onChange(optValue);
      setOpen(false);
      setSearchQuery('');
    } else {
      const newValue = selectedValues.includes(optValue)
        ? selectedValues.filter((v) => v !== optValue)
        : [...selectedValues, optValue];
      onChange(newValue);
    }
  };

  const handleRemove = (optValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === 'single') {
      onChange('');
    } else {
      onChange(selectedValues.filter((v) => v !== optValue));
    }
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(mode === 'single' ? '' : []);
  };

  const displayText = formatValue
    ? formatValue(selectedOptions)
    : mode === 'single'
      ? selectedOptions[0]?.label ?? ''
      : selectedOptions.length > 0
        ? `已选 ${selectedOptions.length} 项`
        : '';

  const hasValue = mode === 'single' ? !!value : selectedValues.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button (looks like a native select) */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-xs focus-visible:outline-[var(--primary)] cursor-pointer text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        style={{
          background: 'var(--bg)',
          border: `1px solid ${open ? 'var(--primary)' : 'var(--border)'}`,
          color: hasValue ? 'var(--ink)' : 'var(--muted)',
        }}
      >
        {mode === 'multiple' && selectedValues.length > 0 ? (
          <div className="flex flex-1 flex-wrap items-center gap-1 min-w-0 overflow-hidden">
            {selectedValues.slice(0, 2).map((v) => {
              const opt = options.find((o) => o.value === v);
              return (
                <span
                  key={v}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] shrink-0"
                  style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
                >
                  <span className="truncate max-w-[100px]">{opt?.label ?? v}</span>
                  <X
                    className="h-2.5 w-2.5 cursor-pointer hover:opacity-70"
                    onClick={(e) => handleRemove(v, e)}
                  />
                </span>
              );
            })}
            {selectedValues.length > 2 && (
              <span className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>
                +{selectedValues.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="flex-1 truncate">{displayText || placeholder}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {hasValue && !disabled && (
            <X
              className="h-3 w-3 opacity-50 hover:opacity-100"
              onClick={handleClearAll}
            />
          )}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: 'var(--muted)' }}
          />
        </div>
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border shadow-lg"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          {/* Search Input */}
          <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="relative">
              <Search
                className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2"
                style={{ color: 'var(--muted)' }}
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-full rounded pl-7 pr-2 text-[11px] focus-visible:outline-[var(--primary)]"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--primary-glow)] text-[var(--ink)] font-medium'
                        : 'text-[var(--ink)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {mode === 'multiple' ? (
                      <div
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                            : 'border-[var(--border)] bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                      </div>
                    ) : (
                      <div
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isSelected
                            ? 'border-[var(--primary)] bg-[var(--primary)]'
                            : 'border-[var(--border)] bg-transparent'
                        }`}
                      >
                        {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-[var(--bg)]" />}
                      </div>
                    )}
                    <span className="truncate flex-1" title={opt.label}>
                      {opt.label}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="py-6 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
                {emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
