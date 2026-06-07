import { useState } from 'react';
import type { AgentMessage } from '../../types/agent';
import { useAgentStore } from '../../stores/agentStore';
import { ContextPreview } from './ContextPreview';

interface MessageListProps {
  messages: AgentMessage[];
}

function UserMessage({ message }: { message: AgentMessage }) {
  const [expanded, setExpanded] = useState(false);
  const display = message.displayContent ?? message.content;
  const full = message.fullContent;

  if (!full || display === full) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed">{display}</div>;
  }

  return (
    <div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{display}</div>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs underline opacity-60 hover:opacity-100"
          style={{ color: 'var(--muted)' }}
        >
          展开完整 Prompt
        </button>
      )}
      {expanded && (
        <div
          className="mt-2 whitespace-pre-wrap rounded border p-2 text-xs leading-relaxed"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-light)' }}
        >
          {full}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages }: MessageListProps) {
  const { loadedContext } = useAgentStore();

  if (messages.length === 0) {
    return (
      <div className="p-4">
        {loadedContext && <ContextPreview context={loadedContext} />}
        <div className="flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          与 AI-Sheet Agent 对话，后续可生成公式、提示词和数据处理流程。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" aria-live="polite">
      {loadedContext && <ContextPreview context={loadedContext} />}
      {messages.map((message) => (
        <article key={message.id} className="space-y-1">
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {message.role === 'user' ? 'You' : 'AI-Sheet Agent'}
          </div>
          <div
            className="whitespace-pre-wrap rounded-lg border p-3 text-sm leading-relaxed"
            style={{
              background: message.role === 'assistant' ? 'var(--surface)' : 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--ink)',
            }}
          >
            {message.role === 'user' ? (
              <UserMessage message={message} />
            ) : (
              <>
                {message.content}
                {message.isStreaming && (
                  <span
                    aria-hidden="true"
                    className="streaming-cursor ml-1 inline-block h-4 w-1.5 align-[-2px]"
                    style={{ background: 'var(--primary)' }}
                  />
                )}
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
