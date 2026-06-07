import type { AgentMessage } from '../../types/agent';

interface MessageListProps {
  messages: AgentMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
        与 AI-Sheet Agent 对话，后续可生成公式、提示词和数据处理流程。
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" aria-live="polite">
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
            {message.content}
            {message.isStreaming && (
              <span
                aria-hidden="true"
                className="streaming-cursor ml-1 inline-block h-4 w-1.5 align-[-2px]"
                style={{ background: 'var(--primary)' }}
              />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
