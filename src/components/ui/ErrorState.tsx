import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = '调用失败', message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-lg border p-4 text-sm"
      style={{
        background: 'oklch(0.6 0.12 20 / 0.1)',
        borderColor: 'oklch(0.6 0.12 20 / 0.2)',
      }}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: 'var(--error)' }} />
      <div className="min-w-0 flex-1">
        <p className="font-medium" style={{ color: 'var(--ink)' }}>
          {title}
        </p>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          重试
        </button>
      )}
    </div>
  );
}
