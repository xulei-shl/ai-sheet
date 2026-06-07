import { useEffect, useState } from 'react';
import { FileText, Plus, Search, Pencil, Trash2, X, Check } from 'lucide-react';
import { usePromptStore } from '../stores/promptStore';

export function PromptsPage() {
  const { prompts, searchQuery, setSearchQuery, getFilteredPrompts, savePrompt, updatePrompt, deletePrompt, fetchPrompts } = usePromptStore();

  useEffect(() => { fetchPrompts(); }, []);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');

  const filtered = getFilteredPrompts();

  const resetForm = () => {
    setName('');
    setContent('');
    setCategory('');
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (id: string) => {
    const p = prompts.find((pr) => pr.id === id);
    if (!p) return;
    setName(p.name);
    setContent(p.content);
    setCategory(p.category ?? '');
    setEditId(id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;
    if (editId) {
      updatePrompt(editId, { name: name.trim(), content: content.trim(), category: category.trim() || undefined });
    } else {
      savePrompt({ name: name.trim(), content: content.trim(), category: category.trim() || undefined });
    }
    resetForm();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl p-8">
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-3">
              <FileText className="h-6 w-6" style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>提示词库管理</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              管理和复用已保存的提示词模板。提示词可通过 AI 对话生成，也可手动添加。
            </p>
          </div>

          <div className="mb-6 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
              <input
                type="text"
                className="h-9 w-full rounded-md pl-9 pr-3 text-sm"
                placeholder="搜索提示词..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
            </div>
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
          </div>

          {/* Add/Edit Form */}
          {showForm && (
            <div className="mb-6 rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{editId ? '编辑提示词' : '新建提示词'}</h3>
                <button onClick={resetForm} className="rounded p-1 hover:bg-[var(--surface-hover)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>名称</label>
                  <input
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="提示词名称"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>分类（可选）</label>
                  <input
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="如: 翻译、摘要"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>内容</label>
                <textarea
                  className="w-full resize-none rounded-md px-3 py-2 text-sm"
                  rows={6}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="输入提示词模板内容，使用 {{}} 作为变量占位符"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)', fontFamily: 'ui-monospace, monospace' }}
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={!name.trim() || !content.trim()}
                  className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Check className="h-4 w-4" />
                  {editId ? '更新' : '保存'}
                </button>
                <button onClick={resetForm} className="rounded-md px-4 py-2 text-sm" style={{ color: 'var(--muted)' }}>取消</button>
              </div>
            </div>
          )}

          {/* Prompt List */}
          {filtered.length > 0 ? (
            <div className="space-y-3">
              {filtered.map((prompt) => (
                <div key={prompt.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{prompt.name}</h3>
                        {prompt.category && (
                          <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                            {prompt.category}
                          </span>
                        )}
                      </div>
                      <pre className="mt-2 max-h-24 overflow-hidden rounded-md p-2 text-xs leading-relaxed" style={{ background: 'var(--bg)', color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {prompt.content}
                      </pre>
                      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                        更新于 {new Date(prompt.updatedAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <div className="ml-4 flex gap-1">
                      <button onClick={() => handleEdit(prompt.id)} className="rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--muted)' }} title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deletePrompt(prompt.id)} className="rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--error)' }} title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg p-12 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <FileText className="mb-3 h-12 w-12" style={{ color: 'var(--muted)' }} />
              <h3 className="mb-1 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {searchQuery ? '未找到匹配的提示词' : '暂无保存的提示词'}
              </h3>
              <p className="mb-4 max-w-sm text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                {searchQuery ? '尝试修改搜索关键词' : '在右栏通过 AI 对话生成提示词后，可以保存以便后续在批量处理中复用。'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => { resetForm(); setShowForm(true); }}
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Plus className="h-4 w-4" />
                  新建提示词
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
