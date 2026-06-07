import { useEffect, useState } from 'react';
import { FileText, Plus, Search, Pencil, Trash2, X, Check, Eye, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePromptStore } from '../stores/promptStore';

type Mode = 'view' | 'create' | 'edit';
type ViewTab = 'preview' | 'raw';

export function PromptsPage() {
  const { prompts, searchQuery, setSearchQuery, getFilteredPrompts, savePrompt, updatePrompt, deletePrompt, fetchPrompts } = usePromptStore();

  useEffect(() => { fetchPrompts(); }, []);

  const [mode, setMode] = useState<Mode>('view');
  const [viewTab, setViewTab] = useState<ViewTab>('preview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');

  const filtered = getFilteredPrompts();
  const selected = selectedId ? prompts.find((p) => p.id === selectedId) ?? null : null;

  const clearForm = () => {
    setName('');
    setContent('');
    setCategory('');
  };

  const loadIntoForm = (id: string) => {
    const p = prompts.find((pr) => pr.id === id);
    if (!p) return;
    setName(p.name);
    setContent(p.content);
    setCategory(p.category ?? '');
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    loadIntoForm(id);
    setMode('view');
    setViewTab('preview');
  };

  const handleNew = () => {
    setSelectedId(null);
    clearForm();
    setMode('create');
  };

  const handleEdit = () => {
    if (!selectedId) return;
    loadIntoForm(selectedId);
    setMode('edit');
  };

  const handleCancel = () => {
    if (mode === 'edit' && selectedId) {
      loadIntoForm(selectedId);
      setMode('view');
    } else {
      setSelectedId(null);
      clearForm();
      setMode('view');
    }
  };

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;
    if (mode === 'edit' && selectedId) {
      updatePrompt(selectedId, { name: name.trim(), content: content.trim(), category: category.trim() || undefined });
      setMode('view');
      setViewTab('preview');
    } else if (mode === 'create') {
      savePrompt({ name: name.trim(), content: content.trim(), category: category.trim() || undefined });
      clearForm();
      setMode('view');
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deletePrompt(selectedId);
    setSelectedId(null);
    clearForm();
    setMode('view');
  };

  const isEditing = mode === 'create' || mode === 'edit';

  return (
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)]">
      {/* Left Sidebar: Search + New + List */}
      <div
        className="w-80 shrink-0 border-r flex flex-col overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>提示词库</span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
                {filtered.length}
              </span>
            </div>
            <button
              onClick={handleNew}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              <Plus className="h-3 w-3" />
              新建
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
            <input
              type="text"
              className="h-8 w-full rounded-md pl-8 pr-3 text-xs"
              placeholder="搜索提示词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length > 0 ? (
            filtered.map((prompt) => {
              const isSelected = selectedId === prompt.id;
              return (
                <div
                  key={prompt.id}
                  onClick={() => handleSelect(prompt.id)}
                  className={`group rounded-md px-2.5 py-2 cursor-pointer transition-colors border ${
                    isSelected
                      ? 'border-[var(--primary)]'
                      : 'border-transparent hover:bg-[var(--surface-hover)]'
                  }`}
                  style={isSelected ? { background: 'var(--primary-glow)' } : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-xs font-medium" style={{ color: 'var(--ink)' }}>
                      {prompt.name}
                    </h3>
                    {prompt.category && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0 text-[10px] truncate max-w-[80px]"
                        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
                        title={prompt.category}
                      >
                        {prompt.category}
                      </span>
                    )}
                    {prompt.isSystem && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0 text-[10px]"
                        style={{ background: 'var(--bg)', color: 'var(--primary)' }}
                      >
                        系统
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                    {prompt.content.replace(/\s+/g, ' ').slice(0, 60)}
                  </p>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <FileText className="mb-2 h-8 w-8" style={{ color: 'var(--muted)' }} />
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {searchQuery ? '未找到匹配的提示词' : '暂无保存的提示词'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleNew}
                  className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Plus className="h-3 w-3" />
                  新建提示词
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Content: Detail view or Form */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {mode === 'view' && !selected && (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <FileText className="h-7 w-7" style={{ color: 'var(--primary)' }} />
              </div>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                提示词库管理
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                管理和复用已保存的提示词模板。提示词可通过 AI 对话生成，也可手动添加。从左侧选择一个提示词查看详情，或点击"新建"创建新的提示词。
              </p>
            </div>
          </div>
        )}

        {mode === 'view' && selected && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className="flex items-start justify-between gap-4 border-b p-5"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold" style={{ color: 'var(--ink)' }}>
                    {selected.name}
                  </h2>
                  {selected.category && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                      style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
                    >
                      {selected.category}
                    </span>
                  )}
                  {selected.isSystem && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                      style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                    >
                      系统
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  更新于 {new Date(selected.updatedAt).toLocaleString('zh-CN')}
                  {' · '}
                  创建于 {new Date(selected.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={handleEdit}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑
                </button>
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--error)' }}
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* View tabs */}
            <div
              className="flex items-center gap-1 border-b px-5"
              style={{ borderColor: 'var(--border)' }}
            >
              {([
                { key: 'preview', label: '预览', icon: Eye },
                { key: 'raw', label: '原文', icon: Code2 },
              ] as const).map(({ key, label, icon: Icon }) => {
                const active = viewTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setViewTab(key)}
                    className={`relative inline-flex items-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
                      active ? '' : 'hover:text-[var(--ink)]'
                    }`}
                    style={{ color: active ? 'var(--primary)' : 'var(--muted)' }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {active && (
                      <span
                        className="absolute inset-x-0 -bottom-px h-0.5"
                        style={{ background: 'var(--primary)' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-auto p-5">
              {viewTab === 'preview' ? (
                <div
                  className="markdown-body rounded-md p-4"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    minHeight: '100%',
                  }}
                >
                  {selected.content.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selected.content}
                    </ReactMarkdown>
                  ) : (
                    <p style={{ color: 'var(--muted)' }}>（无内容）</p>
                  )}
                </div>
              ) : (
                <pre
                  className="rounded-md p-4 text-sm leading-relaxed whitespace-pre-wrap break-words"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontFamily: 'ui-monospace, monospace',
                    border: '1px solid var(--border)',
                    minHeight: '100%',
                  }}
                >
                  {selected.content}
                </pre>
              )}
            </div>
          </div>
        )}

        {isEditing && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className="flex items-center justify-between border-b p-5"
              style={{ borderColor: 'var(--border)' }}
            >
              <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {mode === 'create' ? '新建提示词' : '编辑提示词'}
              </h2>
              <button
                onClick={handleCancel}
                className="rounded p-1 hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--muted)' }}
                title="取消"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="grid grid-cols-2 gap-4 border-b p-5"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  名称
                </label>
                <input
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="提示词名称"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  分类（可选）
                </label>
                <input
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="如: 翻译、摘要"
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col p-5 overflow-hidden gap-1.5">
              <div className="flex items-center justify-between shrink-0">
                <label className="block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  内容 <span style={{ color: 'var(--muted)' }}>（支持 Markdown · 可拖动右下角调整高度）</span>
                </label>
                <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                  {content.length} 字
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <textarea
                  className="block w-full resize-y rounded-md px-3 py-2 text-sm leading-relaxed"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="输入提示词模板内容，使用 {{}} 作为变量占位符，支持 Markdown 语法"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                    fontFamily: 'ui-monospace, monospace',
                    minHeight: '100%',
                  }}
                />
              </div>
            </div>

            <div
              className="flex items-center gap-3 border-t p-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <button
                onClick={handleSave}
                disabled={!name.trim() || !content.trim()}
                className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Check className="h-4 w-4" />
                {mode === 'edit' ? '更新' : '保存'}
              </button>
              <button
                onClick={handleCancel}
                className="rounded-md px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--muted)' }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
