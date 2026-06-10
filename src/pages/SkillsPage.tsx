import { useEffect, useState } from 'react';
import {
  Wrench,
  Plus,
  Search,
  Trash2,
  X,
  Check,
  Eye,
  Code2,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  RefreshCw,
  Pencil,
  Download,
  FilePlus,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useSkillStore } from '../stores/skillStore';
import { MarkdownRenderer } from '../components/ui/MarkdownRenderer';
import type { FileNode } from '../types/skill';

type Mode = 'view' | 'create' | 'edit';
type ViewTab = 'preview' | 'raw';

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['py', 'js', 'ts', 'jsx', 'tsx', 'rs', 'go', 'sh', 'bat'].includes(ext)) return FileCode;
  return FileText;
}

function isMarkdownFile(name: string) {
  return name.toLowerCase().endsWith('.md');
}

function FileTree({
  nodes,
  selectedFile,
  expandedDirs,
  onFileSelect,
  onToggleDir,
  depth = 0,
}: {
  nodes: FileNode[];
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onFileSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.is_dir) {
          const isExpanded = expandedDirs.has(node.path);
          const Icon = isExpanded ? FolderOpen : Folder;
          return (
            <div key={node.path}>
              <button
                onClick={() => onToggleDir(node.path)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-[var(--surface-hover)] transition-colors"
                style={{ paddingLeft: `${depth * 16 + 6}px`, color: 'var(--ink)' }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--primary)' }} />
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  selectedFile={selectedFile}
                  expandedDirs={expandedDirs}
                  onFileSelect={onFileSelect}
                  onToggleDir={onToggleDir}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const Icon = getFileIcon(node.name);
        const isActive = selectedFile === node.path;
        const isSkillMd = node.path === 'SKILL.md';
        return (
          <button
            key={node.path}
            onClick={() => onFileSelect(node.path)}
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors"
            style={{
              paddingLeft: `${depth * 16 + 6}px`,
              color: isActive ? 'var(--primary)' : 'var(--ink)',
              background: isActive ? 'var(--primary-glow)' : 'transparent',
              fontWeight: isSkillMd ? 600 : 400,
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

export function SkillsPage() {
  const {
    skills,
    detail,
    fileTree,
    selectedFile,
    selectedFileContent,
    searchQuery,
    setSearchQuery,
    getFilteredSkills,
    fetchSkills,
    selectSkill,
    selectFile,
    createSkill,
    deleteSkill,
    updateSkillFile,
    deleteSkillFile,
    createSkillFile,
    importSkillFromFolder,
    refreshFileTree,
    clearSelection,
  } = useSkillStore();

  const [mode, setMode] = useState<Mode>('view');
  const [viewTab, setViewTab] = useState<ViewTab>('preview');
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Create form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formContent, setFormContent] = useState('');

  // Edit state
  const [editContent, setEditContent] = useState('');

  // New file state
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  useEffect(() => {
    fetchSkills();
  }, []);

  const handleSelectSkill = (name: string) => {
    setSelectedSkillName(name);
    setViewTab('preview');
    setExpandedDirs(new Set());
    setMode('view');
    setShowNewFile(false);
    selectSkill(name);
  };

  const handleFileSelect = (path: string) => {
    if (!selectedSkillName) return;
    selectFile(selectedSkillName, path);
    setViewTab(isMarkdownFile(path) ? 'preview' : 'raw');
    setMode('view');
    setShowNewFile(false);
  };

  const handleToggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleNew = () => {
    setMode('create');
    setFormName('');
    setFormDescription('');
    setFormContent('');
  };

  const handleImport = async () => {
    const selected = await open({ directory: true, title: '选择技能文件夹' });
    if (!selected) return;
    const folderPath = typeof selected === 'string' ? selected : selected;
    if (!folderPath) return;

    const skillName = folderPath.split(/[/\\]/).pop() ?? 'imported-skill';
    const skill = await importSkillFromFolder(folderPath, skillName);
    if (skill) {
      setSelectedSkillName(skill.name);
      setMode('view');
      selectSkill(skill.name);
    }
  };

  const handleSaveCreate = async () => {
    if (!formName.trim() || !formDescription.trim()) return;
    await createSkill({
      name: formName.trim(),
      description: formDescription.trim(),
      content: formContent.trim(),
    });
    setMode('view');
    setFormName('');
    setFormDescription('');
    setFormContent('');
    fetchSkills();
  };

  const handleEdit = () => {
    const content = selectedFile ? (selectedFileContent ?? '') : (detail?.content ?? '');
    setEditContent(content);
    setMode('edit');
  };

  const handleSaveEdit = async () => {
    if (!selectedSkillName) return;
    if (selectedFile) {
      await updateSkillFile(selectedSkillName, selectedFile, editContent);
    } else {
      // Editing SKILL.md: we write the full content (without frontmatter changes for simplicity)
      await updateSkillFile(selectedSkillName, 'SKILL.md', editContent);
      // Refresh detail after SKILL.md edit
      selectSkill(selectedSkillName);
    }
    setMode('view');
  };

  const handleCancelEdit = () => {
    setMode('view');
    setEditContent('');
  };

  const handleDeleteSkill = async (name: string) => {
    if (!window.confirm(`确定要删除技能 "${name}" 吗？此操作不可撤销。`)) return;
    await deleteSkill(name);
    if (selectedSkillName === name) {
      setSelectedSkillName(null);
      clearSelection();
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    if (!selectedSkillName) return;
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    if (!window.confirm(`确定要删除 "${fileName}" 吗？此操作不可撤销。`)) return;
    await deleteSkillFile(selectedSkillName, filePath);
    refreshFileTree(selectedSkillName);
  };

  const handleCreateFile = async () => {
    if (!selectedSkillName || !newFilePath.trim()) return;
    await createSkillFile(selectedSkillName, newFilePath.trim(), newFileContent);
    setShowNewFile(false);
    setNewFilePath('');
    setNewFileContent('');
    refreshFileTree(selectedSkillName);
  };

  const handleRefresh = () => {
    fetchSkills();
    if (selectedSkillName) {
      selectSkill(selectedSkillName);
    }
  };

  // Determine active content for display
  const activeContent = selectedFile
    ? selectedFileContent ?? ''
    : detail?.content ?? '';
  const activeName = selectedFile
    ? selectedFile.split(/[/\\]/).pop() ?? selectedFile
    : detail?.name ?? '';
  const isMarkdown = selectedFile
    ? isMarkdownFile(selectedFile)
    : true;

  return (
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)]">
      {/* ─── Left: Skill List ──────────────────────────────────────── */}
      <div
        className="w-72 shrink-0 border-r flex flex-col overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>技能库</span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
                {getFilteredSkills().length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefresh}
                className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--muted)' }}
                title="刷新"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleImport}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                title="从本地文件夹导入"
              >
                <Download className="h-3 w-3" />
                导入
              </button>
              <button
                onClick={handleNew}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Plus className="h-3 w-3" />
                新建
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
            <input
              type="text"
              className="h-8 w-full rounded-md pl-8 pr-3 text-xs"
              placeholder="搜索技能..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {getFilteredSkills().length > 0 ? (
            getFilteredSkills().map((skill) => {
              const isSelected = selectedSkillName === skill.name;
              return (
                <div
                  key={skill.name}
                  onClick={() => handleSelectSkill(skill.name)}
                  className={`group relative rounded-md px-2.5 py-2 cursor-pointer transition-colors border ${
                    isSelected
                      ? 'border-[var(--primary)]'
                      : 'border-transparent hover:bg-[var(--surface-hover)]'
                  }`}
                  style={isSelected ? { background: 'var(--primary-glow)' } : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5 shrink-0" style={{ color: isSelected ? 'var(--primary)' : 'var(--muted)' }} />
                    <h3 className="truncate text-xs font-medium" style={{ color: 'var(--ink)' }}>
                      {skill.name}
                    </h3>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] pl-5" style={{ color: 'var(--muted)' }}>
                    {skill.description || '（无描述）'}
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSkill(skill.name); }}
                    className="absolute right-1.5 top-1.5 hidden rounded p-0.5 hover:bg-[var(--surface-hover)] group-hover:block"
                    style={{ color: 'var(--error)' }}
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <Wrench className="mb-2 h-8 w-8" style={{ color: 'var(--muted)' }} />
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {searchQuery ? '未找到匹配的技能' : '暂无技能'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleNew}
                  className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Plus className="h-3 w-3" />
                  新建技能
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Content ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {mode === 'create' ? (
          /* ─── Create Form ────────────────────────────────────────── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className="flex items-center justify-between border-b p-5"
              style={{ borderColor: 'var(--border)' }}
            >
              <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>新建技能</h2>
              <button
                onClick={() => setMode('view')}
                className="rounded p-1 hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--muted)' }}
                title="取消"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 border-b p-5" style={{ borderColor: 'var(--border)' }}>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  技能名称（小写字母、数字、连字符）
                </label>
                <input
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-skill"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  描述
                </label>
                <input
                  className="h-9 w-full rounded-md px-3 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="技能的简短描述"
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col p-5 overflow-hidden gap-1.5">
              <div className="flex items-center justify-between shrink-0">
                <label className="block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  SKILL.md 内容 <span style={{ color: 'var(--muted)' }}>（支持 Markdown）</span>
                </label>
                <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                  {formContent.length} 字
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <textarea
                  className="block w-full resize-y rounded-md px-3 py-2 text-sm leading-relaxed"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="输入技能的 Markdown 内容，包括工作流程、模板、最佳实践等"
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

            <div className="flex items-center gap-3 border-t p-4" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={handleSaveCreate}
                disabled={!formName.trim() || !formDescription.trim()}
                className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Check className="h-4 w-4" />
                创建
              </button>
              <button
                onClick={() => setMode('view')}
                className="rounded-md px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--muted)' }}
              >
                取消
              </button>
            </div>
          </div>
        ) : selectedSkillName && detail ? (
          /* ─── View/Edit Mode: File Tree + Content ─────────────────── */
          <div className="flex flex-1 flex-row overflow-hidden">
            {/* File tree */}
            <div
              className="w-56 shrink-0 border-r flex flex-col overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>
                    {selectedSkillName}
                  </span>
                </div>
                <button
                  onClick={() => { setShowNewFile(!showNewFile); setNewFilePath(''); setNewFileContent(''); }}
                  className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--muted)' }}
                  title="新建文件"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* New file input */}
              {showNewFile && (
                <div className="p-2 border-b space-y-2" style={{ borderColor: 'var(--border)' }}>
                  <input
                    className="h-7 w-full rounded px-2 text-xs"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    placeholder="文件路径，如 scripts/run.py"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCreateFile}
                      disabled={!newFilePath.trim()}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      <Check className="h-3 w-3" />
                      创建
                    </button>
                    <button
                      onClick={() => setShowNewFile(false)}
                      className="rounded px-2 py-1 text-[11px] hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--muted)' }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-1.5">
                <FileTree
                  nodes={fileTree}
                  selectedFile={selectedFile}
                  expandedDirs={expandedDirs}
                  onFileSelect={handleFileSelect}
                  onToggleDir={handleToggleDir}
                />
              </div>
            </div>

            {/* Content area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Header */}
              <div
                className="flex items-end justify-between gap-4 border-b p-4"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedFile ? (() => {
                      const Icon = getFileIcon(selectedFile);
                      return <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--primary)' }} />;
                    })() : null}
                    <h2 className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {activeName}
                    </h2>
                  </div>
                  {!selectedFile && detail.description && (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      — {detail.description}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {mode === 'view' && (
                    <button
                      onClick={handleEdit}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                  )}
                  {selectedFile && mode === 'view' && (
                    <button
                      onClick={() => handleDeleteFile(selectedFile)}
                      className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--error)' }}
                      title="删除文件"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {!selectedFile && mode === 'view' && (
                    <button
                      onClick={() => handleDeleteSkill(selectedSkillName)}
                      className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--error)' }}
                      title="删除技能"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {mode === 'edit' ? (
                /* ─── Edit Mode ─────────────────────────────────────── */
                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="flex flex-1 flex-col p-5 overflow-hidden gap-1.5">
                    <div className="flex items-center justify-between shrink-0">
                      <label className="block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                        编辑 {selectedFile || 'SKILL.md'} 内容
                      </label>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                        {editContent.length} 字
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      <textarea
                        className="block w-full resize-y rounded-md px-3 py-2 text-sm leading-relaxed"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
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
                  <div className="flex items-center gap-3 border-t p-4" style={{ borderColor: 'var(--border)' }}>
                    <button
                      onClick={handleSaveEdit}
                      className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium"
                      style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      <Check className="h-4 w-4" />
                      保存
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="rounded-md px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--muted)' }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* ─── View Mode ──────────────────────────────────────── */
                <>
                  {/* View tabs (only for markdown files) */}
                  {isMarkdown && (
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
                  )}

                  <div className="flex-1 overflow-auto p-5">
                    {viewTab === 'preview' && isMarkdown ? (
                      <div
                        className="markdown-body rounded-md p-4"
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          minHeight: '100%',
                        }}
                      >
                        {activeContent.trim() ? (
                          <MarkdownRenderer content={activeContent} />
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
                        {activeContent}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          /* ─── Empty State ────────────────────────────────────────── */
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <Wrench className="h-7 w-7" style={{ color: 'var(--primary)' }} />
              </div>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                技能管理
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                管理和配置 AI 技能工作流。每个技能是一个包含 SKILL.md 的文件夹，可包含模板、脚本等辅助文件。支持从本地文件夹导入、查看/编辑文件内容、新增/删除子文件。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
