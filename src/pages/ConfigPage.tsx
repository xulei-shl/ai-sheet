import { useState, useEffect } from 'react';
import { Network, Plus, ShieldCheck, Pencil, Trash2, RefreshCw, X, Check } from 'lucide-react';
import { useConfigStore } from '../stores/configStore';
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

export function ConfigPage() {
  const { fallbackModels, userModels, loading, fetchModels, addModel, updateModel, deleteModel, testConnection } = useConfigStore();
  const [showForm, setShowForm] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState<ModelFormData>(emptyForm);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { fetchModels(); }, []);

  const resetForm = () => { setForm(emptyForm); setEditIdx(null); setShowForm(false); setTestResult(null); };

  const handleEdit = (model: ModelConfig, idx: number) => {
    setForm({
      name: model.name,
      apiKey: model.apiKey || '',
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      providerType: model.providerType,
    });
    setEditIdx(idx);
    setShowForm(true);
    setTestResult(null);
  };

  const handleSave = () => {
    if (!form.name || !form.baseUrl || !form.modelId) return;
    const model: ModelConfig = {
      name: form.name,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      providerType: form.providerType,
      isDefault: false,
      source: 'user',
    };
    if (editIdx !== null) {
      updateModel(editIdx, model);
    } else {
      addModel(model);
    }
    resetForm();
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

  const renderModelCard = (model: ModelConfig, idx: number, isUser: boolean) => (
    <div key={`${isUser ? 'user' : 'builtin'}-${idx}`} className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
          {model.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {model.name}{model.isDefault ? '（默认）' : ''}
            </p>
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}>
              {isUser ? '用户配置' : '内置免费'}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            {model.modelId} · {new URL(model.baseUrl).hostname} · {model.providerType}
          </p>
        </div>
        {isUser && (
          <div className="flex gap-1">
            <button onClick={() => handleEdit(model, idx)} className="rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--muted)' }} title="编辑">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => deleteModel(idx)} className="rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--error)' }} title="删除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl p-8">
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-3">
              <Network className="h-6 w-6" style={{ color: 'var(--primary)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>模型配置管理</h2>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              管理 LLM API 配置，支持多模型配置和自动降级。当用户配置不可用时，自动使用内置默认模型。
            </p>
          </div>

          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>已配置的模型</h3>
              <div className="flex gap-2">
                <button
                  onClick={fetchModels}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ color: 'var(--muted)' }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
                <button
                  onClick={() => { resetForm(); setShowForm(true); }}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增模型
                </button>
              </div>
            </div>

            {/* User Models */}
            {userModels.map((model, i) => renderModelCard(model, i, true))}

            {/* Built-in Fallback Models */}
            {fallbackModels.map((model, i) => renderModelCard(model, i, false))}

            {userModels.length === 0 && fallbackModels.length === 0 && (
              <div className="rounded-lg p-8 text-center text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                暂无模型配置，将使用内置默认模型
              </div>
            )}
          </div>

          {/* Add/Edit Form */}
          {showForm && (
            <div className="mb-6 rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{editIdx !== null ? '编辑模型' : '新增模型'}</h3>
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
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="如: 我的模型"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Provider 类型</label>
                  <select
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={form.providerType}
                    onChange={(e) => setForm({ ...form, providerType: e.target.value })}
                  >
                    {PROVIDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>API Base URL</label>
                  <input
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Model ID</label>
                  <input
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={form.modelId}
                    onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                    placeholder="gpt-4o"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>API Key</label>
                  <input
                    type="password"
                    className="h-9 w-full rounded-md px-3 text-sm"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={!form.name || !form.baseUrl || !form.modelId}
                  className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Check className="h-4 w-4" />
                  {editIdx !== null ? '更新' : '保存'}
                </button>
                <button
                  onClick={handleTest}
                  disabled={!form.baseUrl || testing}
                  className="inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  测试连接
                </button>
                <button onClick={resetForm} className="rounded-md px-4 py-2 text-sm" style={{ color: 'var(--muted)' }}>取消</button>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 rounded-md p-3 text-sm ${testResult.ok ? 'text-green-600' : 'text-red-500'}`} style={{ background: testResult.ok ? 'oklch(0.65 0.1 150 / 0.1)' : 'oklch(0.6 0.12 20 / 0.1)' }}>
                  {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  {testResult.message}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-3 rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>API Key 加密存储</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                所有 API Key 使用本地存储加密保存。添加新模型配置后，若调用失败将自动降级至内置免费模型。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
