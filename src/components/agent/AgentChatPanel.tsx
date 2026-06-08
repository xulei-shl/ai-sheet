import { Bot, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { onAgentEvent, onSidecarDead, onSidecarRestarted } from '../../services/tauri';
import { useAgentStore } from '../../stores/agentStore';
import { ErrorState } from '../ui/ErrorState';
import { AgentInput } from './AgentInput';
import { MessageList } from './MessageList';
import { QuickActionBar } from './QuickActionBar';

export function AgentChatPanel() {
  const {
    error,
    handleEvent,
    markOffline,
    messages,
    refreshStatus,
    restart,
    sendMessage,
    status,
  } = useAgentStore();

  const agentStreamingRequestId = useAgentStore((s) => s.agentStreamingRequestId);

  const [agentInput, setAgentInput] = useState('');
  const [quickPlaceholder, setQuickPlaceholder] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();

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
  }, [handleEvent, markOffline, refreshStatus]);

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
        <button
          type="button"
          onClick={() => void restart()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          aria-label="重连 Agent"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {error && (
        <div className="p-3">
          <ErrorState message={error} onRetry={() => void restart()} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <MessageList messages={messages} />
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
        value={agentInput}
        onValueChange={(v) => { setAgentInput(v); setQuickPlaceholder(null); }}
        placeholder={placeholder}
      />
    </section>
  );
}
