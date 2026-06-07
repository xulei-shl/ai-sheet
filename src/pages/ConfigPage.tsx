import { useEffect, useMemo, useState } from 'react';
import { Network, Plus, ShieldCheck, Pencil, Trash2, RefreshCw, X, Check, ChevronRight } from 'lucide-react';
import { mergeModels, useConfigStore, type DisplayModel } from '../stores/configStore';
import type { ModelConfig } from '../types/config';

const PROVIDER_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Compatible' },
  { value: 'openai-chat', label: 'OpenAI Chat' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

interface ModelFormData {
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  providerType: string;
}

const emptyForm: ModelFormData = {
  name: '',
  apiKey: '',
  baseUrl: '',
  modelId: '',
  providerType: 'openai-completions',
};

type Mode = 'view' | 'create' | 'edit';

export function ConfigPage() {
  const {
    userModels,
    fallbackModels,
    loading,
    fetchModels,
    addModel,
    updateModel,
    deleteModel,
    testConnection,
  } = useConfigStore();

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [form, setForm] = useState<ModelFormData>(emptyForm);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const merged: DisplayModel[] = useMemo(
    () => mergeModels(userModels, fallbackModels),
    [userModels, fallbackModels],
  );

  const selected: DisplayModel | null = useMemo(
    () => (selectedName ? merged.find((m) => m.name === selectedName) ?? null : null),
    [selectedName, merged],
  );

  const resetForm = () => {
    setForm(emptyForm);
    setTestResult(null);
  };

  const loadIntoForm = (model: ModelConfig) => {
    setForm({
      name: model.name,
      apiKey: model.apiKey || '',
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      providerType: model.providerType,
    });
    setTestResult(null);
  };

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setMode('view');
    const m = merged.find((x) => x.name === name);
    if (m) loadIntoForm(m);
  };

  const handleNew = () => {
    setSelectedName(null);
    resetForm();
    setMode('create');
  };

  const handleEdit = () => {
    if (!selected) return;
    loadIntoForm(selected);
    setMode('edit');
  };

  const handleCancel = () => {
    if (mode === 'edit' && selected) {
      loadIntoForm(selected);
      setMode('view');
    } else {
      setSelectedName(null);
      resetForm();
      setMode('view');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.modelId.trim()) return;
    const next: ModelConfig = {
      name: form.name.trim(),
      apiKey: form.apiKey,
      baseUrl: form.baseUrl.trim(),
      modelId: form.modelId.trim(),
      providerType: form.providerType,
      isDefault: false,
      source: 'user',
    };

    if (mode === 'edit' && selected) {
      if (selected.displaySource === 'user') {
        const idx = userModels.findIndex((m) => m.name === selected.name);
        if (idx >= 0) {
          await updateModel(idx, next);
        }
      } else {
        await addModel(next);
      }
      setSelectedName(next.name);
      setMode('view');
    } else if (mode === 'create') {
      await addModel(next);
      setSelectedName(next.name);
      setMode('view');
    }
  };

  const handleDelete = async () => {
    if (!selected || selected.displaySource !== 'user') return;
    const idx = userModels.findIndex((m) => m.name === selected.name);
    if (idx >= 0) {
      await deleteModel(idx);
    }
    setSelectedName(null);
    resetForm();
    setMode('view');
  };

  const handleTest = async () => {
    if (!form.baseUrl) return;
    setTesting(true);
    setTestResult(null);
    const err = await testConnection({
      name: form.name,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      providerType: form.providerType,
      isDefault: false,
      source: 'user',
    });
    setTestResult({ ok: !err, message: err || '连接成功' });
    setTesting(false);
  };

  const isEditing = mode === 'create' || mode === 'edit';

  return (
    <div className="flex h-full flex-row overflow-hidden bg-[var(--bg)]">
      {/* Left Sidebar: List + New */}
      <div
        className="w-80 shrink-0 border-r flex flex-col overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>模型列表</span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-mono"
                style={{ background: 'var(--bg)', color: 'var(--muted)' }}
              >
                {merged.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={fetchModels}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md p-1.5"
                style={{ color: 'var(--muted)' }}
                title="刷新"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleNew}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Plus className="h-3 w-3" />
                新增
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {merged.length > 0 ? (
            merged.map((m) => {
              const isSelected = selectedName === m.name;
              const isUser = m.displaySource === 'user';
              return (
                <div
                  key={`${m.displaySource}-${m.name}`}
                  onClick={() => handleSelect(m.name)}
                  className={`group rounded-md px-2.5 py-2 cursor-pointer transition-colors border ${
                    isSelected
                      ? 'border-[var(--primary)]'
                      : 'border-transparent hover:bg-[var(--surface-hover)]'
                  }`}
                  style={isSelected ? { background: 'var(--primary-glow)' } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
                      style={{
                        background: isUser ? 'var(--primary-glow)' : 'var(--bg)',
                        color: isUser ? 'var(--primary)' : 'var(--muted)',
                      }}
                    >
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3
                          className="truncate text-xs font-medium"
                          style={{ color: 'var(--ink)' }}
                        >
                          {m.name}
                        </h3>
                        {m.isDefault && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0 text-[10px]"
                            style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
                          >
                            默认
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                        {m.modelId}
                      </p>
                    </div>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: 'var(--muted)' }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <Network className="mb-2 h-8 w-8" style={{ color: 'var(--muted)' }} />
              <p className="text-xs" style={{ color: 'var(--muted)' }}>暂无模型</p>
              <button
                onClick={handleNew}
                className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Plus className="h-3 w-3" />
                新增模型
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Content: Detail / Form */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Empty state */}
        {mode === 'view' && !selected && (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <Network className="h-7 w-7" style={{ color: 'var(--primary)' }} />
              </div>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                模型配置管理
              </h3>
              <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                管理 LLM API 配置，支持多模型配置和自动降级。从左侧选择一个模型查看详情，或点击"新增"添加新的模型配置。
              </p>
              <div
                className="flex items-start gap-3 rounded-lg p-4 text-left"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <ShieldCheck
                  className="mt-0.5 h-5 w-5 flex-shrink-0"
                  style={{ color: 'var(--success)' }}
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    API Key 加密存储
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    所有 API Key 使用本地存储加密保存。添加新模型配置后，若调用失败将自动降级至内置免费模型。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View */}
        {mode === 'view' && selected && (
          <DetailView
            model={selected}
            isUser={selected.displaySource === 'user'}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}

        {/* Create / Edit */}
        {isEditing && (
          <FormPanel
            mode={mode}
            builtinName={mode === 'edit' && selected?.displaySource === 'builtin' ? selected.name : null}
            form={form}
            setForm={setForm}
            onSave={handleSave}
            onCancel={handleCancel}
            onTest={handleTest}
            testing={testing}
            testResult={testResult}
          />
        )}
      </div>
    </div>
  );
}

function DetailView({
  model,
  isUser,
  onEdit,
  onDelete,
}: {
  model: DisplayModel;
  isUser: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  let hostname = '';
  try {
    hostname = new URL(model.baseUrl).hostname;
  } catch {
    hostname = model.baseUrl;
  }
  const providerLabel =
    PROVIDER_OPTIONS.find((o) => o.value === model.providerType)?.label ?? model.providerType;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex items-start justify-between gap-4 border-b p-5"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold"
            style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
          >
            {model.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2
                className="truncate text-base font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                {model.name}
              </h2>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                style={{
                  background: isUser ? 'var(--primary-glow)' : 'var(--surface)',
                  color: isUser ? 'var(--primary)' : 'var(--muted)',
                  border: isUser ? 'none' : '1px solid var(--border)',
                }}
              >
                {isUser ? '用户配置' : '内置免费'}
              </span>
              {model.isDefault && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                  style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
                >
                  默认
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {model.modelId} · {hostname} · {providerLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </button>
          {isUser && (
            <button
              onClick={onDelete}
              className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--error)' }}
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        <Field label="名称" value={model.name} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model ID" value={model.modelId} />
          <Field label="Provider" value={providerLabel} />
        </div>
        <Field label="API Base URL" value={model.baseUrl} mono />
        <Field
          label="API Key"
          value={model.apiKey ? '••••••••' : '（未设置）'}
        />

        {!isUser && (
          <div
            className="flex items-start gap-3 rounded-lg p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <ShieldCheck
              className="mt-0.5 h-5 w-5 flex-shrink-0"
              style={{ color: 'var(--success)' }}
            />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                内置免费模型
              </p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                任何编辑都会保存为你的用户配置。删除用户配置后，将恢复显示内置默认配置。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label
        className="mb-1 block text-xs font-medium"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      <div
        className="rounded-md px-3 py-2 text-sm"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--ink)',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FormPanel({
  mode,
  builtinName,
  form,
  setForm,
  onSave,
  onCancel,
  onTest,
  testing,
  testResult,
}: {
  mode: Mode;
  builtinName: string | null;
  form: ModelFormData;
  setForm: (f: ModelFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex items-center justify-between border-b p-5"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            {mode === 'create' ? '新增模型' : '编辑模型'}
          </h2>
          {builtinName && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              正在编辑内置模型「{builtinName}」，保存后将作为用户配置生效
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="rounded p-1 hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--muted)' }}
          title="取消"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              名称
            </label>
            <input
              className="h-9 w-full rounded-md px-3 text-sm"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如: 我的模型"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              Provider 类型
            </label>
            <select
              className="h-9 w-full rounded-md px-3 text-sm"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              value={form.providerType}
              onChange={(e) => setForm({ ...form, providerType: e.target.value })}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              API Base URL
            </label>
            <input
              className="h-9 w-full rounded-md px-3 text-sm"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              Model ID
            </label>
            <input
              className="h-9 w-full rounded-md px-3 text-sm"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              API Key
            </label>
            <input
              type="password"
              className="h-9 w-full rounded-md px-3 text-sm"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
        </div>

        {testResult && (
          <div
            className="flex items-center gap-2 rounded-md p-3 text-sm"
            style={{
              background: testResult.ok
                ? 'oklch(0.65 0.1 150 / 0.1)'
                : 'oklch(0.6 0.12 20 / 0.1)',
              color: testResult.ok ? '#16a34a' : 'var(--error)',
            }}
          >
            {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {testResult.message}
          </div>
        )}
      </div>

      <div
        className="flex items-center gap-3 border-t p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={onSave}
          disabled={!form.name.trim() || !form.baseUrl.trim() || !form.modelId.trim()}
          className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          <Check className="h-4 w-4" />
          {mode === 'edit' ? '更新' : '保存'}
        </button>
        <button
          onClick={onTest}
          disabled={!form.baseUrl.trim() || testing}
          className="inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        >
          <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
          测试连接
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
          style={{ color: 'var(--muted)' }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
