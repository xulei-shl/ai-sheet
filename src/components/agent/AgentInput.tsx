import { ChevronDown, Send, Square } from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useConfigStore } from '../../stores/configStore';
import { useUiStore } from '../../stores/uiStore';
import type { ModelConfig } from '../../types/config';

interface AgentInputProps {
  disabled?: boolean;
  isStreaming?: boolean;
  onSend: (content: string) => Promise<void>;
  onStop?: () => void;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}

function ModelAvatar({ name }: { name: string }) {
  const initial = name.slice(0, 2).toUpperCase() || '?';
  return (
    <span
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-semibold"
      style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
    >
      {initial}
    </span>
  );
}

export function AgentInput({ disabled, isStreaming, onSend, onStop, value: controlledValue, onValueChange, placeholder: customPlaceholder }: AgentInputProps) {
  const [localContent, setLocalContent] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapAppliedRef = useRef(false);

  const isControlled = controlledValue !== undefined;
  const content = isControlled ? controlledValue : localContent;
  const setContent = isControlled
    ? (v: string) => onValueChange?.(v)
    : setLocalContent;

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    autoGrow();
  }, [content, autoGrow]);

  const selectedAgentModelName = useUiStore((s) => s.selectedAgentModelName);
  const setSelectedAgentModelName = useUiStore((s) => s.setSelectedAgentModelName);

  const userModels = useConfigStore((s) => s.userModels);
  const activeModel = useConfigStore((s) => s.activeModel);
  const fetchModels = useConfigStore((s) => s.fetchModels);

  const applyModel = useAgentStore((s) => s.applyModel);
  const isApplyingModel = useAgentStore((s) => s.isApplyingModel);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (bootstrapAppliedRef.current) return;
    if (selectedAgentModelName === null) return;
    if (userModels.length === 0) return;
    if (!userModels.some((m) => m.name === selectedAgentModelName)) return;
    bootstrapAppliedRef.current = true;
    void applyModel(selectedAgentModelName);
  }, [selectedAgentModelName, userModels, applyModel]);

  useEffect(() => {
    if (!modelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setModelOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [modelOpen]);

  const currentName = useMemo(() => {
    if (selectedAgentModelName && userModels.some((m) => m.name === selectedAgentModelName)) {
      return selectedAgentModelName;
    }
    return activeModel?.name ?? userModels[0]?.name ?? null;
  }, [selectedAgentModelName, userModels, activeModel]);

  const currentModel = useMemo(
    () => userModels.find((m) => m.name === currentName) ?? null,
    [userModels, currentName],
  );

  function handleModelSelect(name: string) {
    setModelOpen(false);
    if (name === currentName) return;
    setSelectedAgentModelName(name);
    void applyModel(name);
  }

  async function submitMessage() {
    const message = content.trim();
    if (!message || disabled || isStreaming) return;

    setContent('');
    await onSend(message);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitMessage();
    }
  }

  const canSend = !disabled && !isStreaming && !!content.trim();
  const placeholder = customPlaceholder ?? '描述你想处理的数据任务...';

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3"
      aria-label="AI-Sheet Agent 输入"
    >
      <div
        className="rounded-lg border"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <label className="sr-only" htmlFor="agent-input">
          输入给 AI-Sheet Agent 的消息
        </label>
        <textarea
          ref={textareaRef}
          id="agent-input"
          data-ai-input="true"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            autoGrow();
          }}
          disabled={disabled || isStreaming}
          rows={4}
          placeholder={placeholder}
          className="block w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-sm outline-none placeholder:opacity-50 disabled:opacity-60"
          style={{ color: 'var(--ink)', minHeight: '80px', maxHeight: '200px', overflowY: 'hidden' }}
          onKeyDown={handleKeyDown}
        />
        <div
          className="flex items-center justify-between gap-2 px-2 py-1.5"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div ref={modelRef} className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                if (!modelOpen) void fetchModels();
                setModelOpen((o) => !o);
              }}
              disabled={disabled || userModels.length === 0}
              className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: 'var(--ink)' }}
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
            >
              {currentModel ? <ModelAvatar name={currentModel.name} /> : null}
              <span className="truncate">
                {currentModel?.name ?? '未选择模型'}
              </span>
              <ChevronDown
                className={`h-3 w-3 flex-shrink-0 transition-transform ${modelOpen ? 'rotate-180' : ''}`}
                style={{ color: 'var(--muted)' }}
              />
              {isApplyingModel && (
                <span
                  className="ml-1 h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full"
                  style={{ background: 'var(--primary)' }}
                  title="正在切换模型"
                />
              )}
            </button>
            {modelOpen && (
              <div
                className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-64 overflow-y-auto rounded-md border shadow-lg"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
                role="listbox"
              >
                {userModels.length === 0 ? (
                  <div className="p-3 text-xs" style={{ color: 'var(--muted)' }}>
                    暂无可用模型，请到「配置管理」添加
                  </div>
                ) : (
                  userModels.map((m) => {
                    const isSelected = m.name === currentName;
                    return (
                      <button
                        key={m.name}
                        type="button"
                        onClick={() => handleModelSelect(m.name)}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-hover)] ${
                          isSelected ? 'bg-[var(--primary-glow)]' : ''
                        }`}
                        style={{
                          color: 'var(--ink)',
                        }}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <ModelAvatar name={m.name} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{m.name}</div>
                          <div
                            className="truncate text-[10px]"
                            style={{ color: 'var(--muted)' }}
                          >
                            {m.modelId}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onStop?.(); }}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-80"
              style={{ background: 'var(--error)', color: 'white' }}
              aria-label="中断生成"
              title="中断生成"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              aria-label="发送消息"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
