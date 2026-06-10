import { ArrowDown, Bot, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onAgentEvent, onSidecarDead, onSidecarRestarted } from '../../services/tauri';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { usePromptStore } from '../../stores/promptStore';
import { ErrorState } from '../ui/ErrorState';
import { Tooltip } from '../ui/Tooltip';
import { AgentInput } from './AgentInput';
import { MessageList } from './MessageList';
import { QuickActionBar } from './QuickActionBar';

export function AgentChatPanel() {
  const {
    clearMessages,
    error,
    handleEvent,
    markOffline,
    messages,
    refreshStatus,
    restart,
    sendMessage,
    stopStreaming,
    status,
  } = useAgentStore();

  const agentStreamingRequestId = useAgentStore((s) => s.agentStreamingRequestId);

  const [agentInput, setAgentInput] = useState('');
  const [quickPlaceholder, setQuickPlaceholder] = useState<string | null>(null);

  // Auto-scroll state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);

  const fetchPrompts = usePromptStore((s) => s.fetchPrompts);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
  }, []);

  // Auto-scroll on new messages or streaming deltas
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (!isNearBottomRef.current) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isStreaming = agentStreamingRequestId !== null;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: isStreaming || prefersReducedMotion ? 'instant' : 'smooth',
    });
  }, [messages, agentStreamingRequestId]);

  // Reset scroll state when messages are cleared
  useEffect(() => {
    if (messages.length === 0) {
      isNearBottomRef.current = true;
      setIsNearBottom(true);
    }
  }, [messages.length]);

  const handleClear = useCallback(() => {
    useExcelStore.getState().clearAllContext();
    clearMessages();
  }, [clearMessages]);

  useEffect(() => {
    void refreshStatus();
    void fetchPrompts();

    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 5_000);

    const unlisteners = [
      onAgentEvent(handleEvent),
      onSidecarDead(markOffline),
      onSidecarRestarted(() => {
        void refreshStatus();
      }),
    ];

    return () => {
      window.clearInterval(timer);
      void Promise.all(unlisteners).then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [handleEvent, markOffline, refreshStatus, fetchPrompts]);

  const isReady = status?.ready ?? false;
  const isAgentStreaming = agentStreamingRequestId !== null;
  const placeholder = quickPlaceholder ?? '描述你想处理的数据任务...';

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="AI-Sheet Agent">
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b px-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md"
            style={{ background: 'var(--primary-glow)', color: 'var(--primary)' }}
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium whitespace-nowrap">AI-Sheet Agent</h2>
            <span className="text-xs whitespace-nowrap" style={{ color: isReady ? 'var(--success)' : 'var(--muted)' }}>
              {status?.message ?? 'Connecting...'}
            </span>
          </div>
        </div>
        <Tooltip text="清空对话历史" side="bottom">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </header>

      {error && (
        <div className="p-3">
          <ErrorState message={error} onRetry={() => void restart()} />
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <MessageList messages={messages} />
        {!isNearBottom && (
          <button
            type="button"
            onClick={() => {
              const el = scrollContainerRef.current;
              if (el) {
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                isNearBottomRef.current = true;
                setIsNearBottom(true);
              }
            }}
            className="absolute bottom-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border shadow-md transition-opacity hover:opacity-100"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--muted)',
              opacity: 0.8,
            }}
            aria-label="滚动到底部"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      <QuickActionBar
        agentInput={agentInput}
        onAgentInputChange={setAgentInput}
        onSetQuickPlaceholder={setQuickPlaceholder}
      />
      <AgentInput
        disabled={!isReady}
        isStreaming={isAgentStreaming}
        onSend={sendMessage}
        onStop={stopStreaming}
        value={agentInput}
        onValueChange={(v) => { setAgentInput(v); setQuickPlaceholder(null); }}
        placeholder={placeholder}
      />
    </section>
  );
}
