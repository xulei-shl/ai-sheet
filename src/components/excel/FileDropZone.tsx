import { useState, useRef, type DragEvent } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { useExcelStore } from '../../stores/excelStore';

export function FileDropZone() {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addFile = useExcelStore((s) => s.addFile);
  const loading = useExcelStore((s) => s.loading);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      await addFile((file as unknown as { path: string }).path);
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await addFile((file as unknown as { path: string }).path);
    }
  };

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        dragging
          ? 'border-[var(--primary)] bg-[var(--primary-glow)]'
          : 'border-[var(--border)] hover:border-[var(--primary)]'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label="上传 Excel 文件"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>正在处理文件...</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'var(--primary-glow)' }}>
            {dragging ? (
              <Upload className="h-8 w-8" style={{ color: 'var(--primary)' }} />
            ) : (
              <FileSpreadsheet className="h-8 w-8" style={{ color: 'var(--primary)' }} />
            )}
          </div>
          <p className="mb-1 font-medium">拖放 Excel 文件到此处</p>
          <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
            或点击此区域选择文件
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            支持 .xlsx / .xls 格式
          </p>
        </>
      )}
    </div>
  );
}
