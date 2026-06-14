import { useEffect, useMemo, useState } from 'react';
import { Network, Plus, ShieldCheck, Pencil, Trash2, RefreshCw, X, Check, ChevronRight } from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
import type { ModelConfig } from '../types/config';

const PROVIDER_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'mistral-conversations', label: 'Mistral Conversations' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
];

const BASE_URL_PLACEHOLDERS: Record<string, string> = {
  'openai-completions': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
  'deepseek': 'https://api.deepseek.com/v1',
  'mistral-conversations': 'https://api.mistral.ai/v1',
  'google-generative-ai': 'https://generativelanguage.googleapis.com',
};

const MODEL_ID_PLACEHOLDERS: Record<string, string> = {
  'openai-completions': 'gpt-4o-mini',
  'openai-responses': 'gpt-4o',
  'anthropic-messages': 'claude-sonnet-4-20250514',
  'deepseek': 'deepseek-chat',
  'mistral-conversations': 'mistral-large-latest',
  'google-generative-ai': 'gemini-2.0-flash',
};

interface ModelFormData {
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  providerType: string;
  useProxy: boolean;
  contextWindow: string;
}

const emptyForm: ModelFormData = {
  name: '',
  apiKey: '',
  baseUrl: '',
  modelId: '',
  providerType: 'openai-completions',
  useProxy: true,
  contextWindow: '',
};

type Mode = 'view' | 'create' | 'edit';

export function ConfigPage() {
  const {
    userModels,
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
  const [detailTesting, setDetailTesting] = useState(false);
  const [detailTestResult, setDetailTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const selected = useMemo(
    () => (selectedName ? userModels.find((m) => m.name === selectedName) ?? null : null),
    [selectedName, userModels],
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
      useProxy: model.useProxy,
      contextWindow: model.contextWindow ? String(model.contextWindow) : '',
    });
    setTestResult(null);
  };

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setMode('view');
    setDetailTestResult(null);
    const m = userModels.find((x) => x.name === name);
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
    const ctxWindow = form.contextWindow.trim();
    const next: ModelConfig = {
      name: form.name.trim(),
      apiKey: form.apiKey,
      baseUrl: form.baseUrl.trim(),
      modelId: form.modelId.trim(),
      providerType: form.providerType,
      useProxy: form.useProxy,
      contextWindow: ctxWindow ? Number(ctxWindow) : null,
    };

    if (mode === 'edit' && selected) {
      const idx = userModels.findIndex((m) => m.name === selected.name);
      if (idx >= 0) {
        await updateModel(idx, next);
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
    if (!selected) return;
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
      useProxy: form.useProxy,
    });
    setTestResult({ ok: !err, message: err || '连接成功' });
    setTesting(false);
  };

  const handleDetailTest = async () => {
    if (!selected) return;
    setDetailTesting(true);
    setDetailTestResult(null);
    const err = await testConnection({
      name: selected.name,
      apiKey: selected.apiKey,
      baseUrl: selected.baseUrl,
      modelId: selected.modelId,
      providerType: selected.providerType,
      useProxy: selected.useProxy,
    });
    setDetailTestResult({ ok: !err, message: err || '连接成功' });
    setDetailTesting(false);
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
                {userModels.length}
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
          {userModels.length > 0 ? (
            userModels.map((m) => {
              const isSelected = selectedName === m.name;
              return (
                <div
                  key={m.name}
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
                        background: 'var(--primary-glow)',
                        color: 'var(--primary)',
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
                管理 LLM API 配置，支持多模型配置。从左侧选择一个模型查看详情，或点击"新增"添加新的模型配置。
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
                    所有 API Key 使用本地存储加密保存，不会明文写入数据库。
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
            onEdit={handleEdit}
            onDelete={handleDelete}
            onTest={handleDetailTest}
            testing={detailTesting}
            testResult={detailTestResult}
          />
        )}

        {/* Create / Edit */}
        {isEditing && (
          <FormPanel
            mode={mode}
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
  onEdit,
  onDelete,
  onTest,
  testing,
  testResult,
}: {
  model: ModelConfig;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
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
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {model.modelId} · {hostname} · {providerLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            title="测试 API 连通性"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            {testing ? '测试中…' : '测试'}
          </button>
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--error)' }}
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
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
        <Field
          label="上下文窗口"
          value={model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : '默认 128K'}
        />
        <div>
          <label
            className="mb-1 block text-xs font-medium"
            style={{ color: 'var(--muted)' }}
          >
            启用代理
          </label>
          <div
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: model.useProxy ? 'var(--success)' : 'var(--muted)',
            }}
          >
            <div
              className={`h-2 w-2 rounded-full ${model.useProxy ? 'bg-[var(--success)]' : 'bg-[var(--muted)]'}`}
            />
            {model.useProxy ? '已启用（通过 HTTP_PROXY/HTTPS_PROXY）' : '已关闭（直连）'}
          </div>
        </div>

        {testResult && (
          <div
            className="flex items-center gap-2 rounded-md p-3 text-sm"
            style={{
              background: testResult.ok
                ? 'var(--success-soft)'
                : 'var(--error-soft)',
              color: testResult.ok ? 'var(--success)' : 'var(--error)',
            }}
          >
            {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {testResult.message}
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
  form,
  setForm,
  onSave,
  onCancel,
  onTest,
  testing,
  testResult,
}: {
  mode: Mode;
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
        <div className="grid grid-cols-2 gap-4">
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
              placeholder={MODEL_ID_PLACEHOLDERS[form.providerType] ?? 'model-id'}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--muted)' }}
            >
              Provider
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
        </div>
        <div>
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
            placeholder={BASE_URL_PLACEHOLDERS[form.providerType] ?? 'https://...'}
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
        <div>
          <label
            className="mb-1 block text-xs font-medium"
            style={{ color: 'var(--muted)' }}
          >
            上下文窗口（可选）
          </label>
          <input
            type="number"
            min="0"
            step="1000"
            className="h-9 w-full rounded-md px-3 text-sm"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
            }}
            value={form.contextWindow}
            onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
            placeholder="128000"
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--muted)' }}>
            模型的最大上下文 token 数，用于计算上下文使用率。留空使用默认值 128K。
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md px-3 py-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div>
            <span className="text-sm" style={{ color: 'var(--ink)' }}>启用代理</span>
            <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
              {form.useProxy ? '通过 HTTP_PROXY/HTTPS_PROXY' : '直连'}
            </span>
          </div>
          <button
            role="switch"
            aria-checked={form.useProxy}
            onClick={() => setForm({ ...form, useProxy: !form.useProxy })}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors"
            style={{
              background: form.useProxy ? 'var(--primary)' : 'var(--border)',
            }}
          >
            <span
              className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{
                transform: form.useProxy ? 'translateX(18px)' : 'translateX(2px)',
                marginTop: '2px',
              }}
            />
          </button>
        </div>

        {testResult && (
          <div
            className="flex items-center gap-2 rounded-md p-3 text-sm"
            style={{
              background: testResult.ok
                ? 'var(--success-soft)'
                : 'var(--error-soft)',
              color: testResult.ok ? 'var(--success)' : 'var(--error)',
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
