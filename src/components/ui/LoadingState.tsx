export function LoadingState() {
  return (
    <div className="space-y-3 p-6" aria-label="正在加载" aria-live="polite">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex animate-pulse gap-4">
          <div className="h-10 w-12 rounded" style={{ background: 'var(--surface)' }} />
          <div className="h-10 flex-1 rounded" style={{ background: 'var(--surface)' }} />
          <div className="h-10 w-24 rounded" style={{ background: 'var(--surface)' }} />
        </div>
      ))}
    </div>
  );
}
