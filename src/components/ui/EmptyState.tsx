import { FileSpreadsheet, Upload } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
}

export function EmptyState({
  title = '还没有数据',
  description = '请先上传 Excel 文件，后续可在这里预览 Sheet、列和样本数据。',
  actionLabel = '上传 Excel',
}: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <FileSpreadsheet className="mb-4 h-16 w-16" style={{ color: 'var(--muted)' }} />
      <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      <p className="mb-6 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
        {description}
      </p>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}
