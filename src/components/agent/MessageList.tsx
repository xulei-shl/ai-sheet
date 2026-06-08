import { AlertTriangle, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentMessage } from '../../types/agent';
import { useAgentStore } from '../../stores/agentStore';
import { ContextPreview } from './ContextPreview';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100!"
      style={{ color: 'var(--muted)' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {copied ? (
          <>
            <polyline points="20 6 9 17 4 12" />
          </>
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        )}
      </svg>
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function RetryButton({ messageId }: { messageId: string }) {
  const retryMessage = useAgentStore((s) => s.retryMessage);
  return (
    <button
      type="button"
      onClick={() => retryMessage(messageId)}
      className="flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100!"
      style={{ color: 'var(--muted)' }}
      title="重新生成"
    >
      <RotateCw className="h-3 w-3" />
      重试
    </button>
  );
}

function DeleteButton({ messageId }: { messageId: string }) {
  const deleteMessage = useAgentStore((s) => s.deleteMessage);
  return (
    <button
      type="button"
      onClick={() => deleteMessage(messageId)}
      className="flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100!"
      style={{ color: 'var(--muted)' }}
      title="删除"
    >
      <Trash2 className="h-3 w-3" />
      删除
    </button>
  );
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const userInteractingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 100;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      userInteractingRef.current = !isNearBottom;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || userInteractingRef.current) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

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
    <div ref={containerRef} className="space-y-4 p-4" aria-live="polite">
      {loadedContext && <ContextPreview context={loadedContext} />}
      {messages.map((message) => (
        <article key={message.id} className="group space-y-1">
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {message.role === 'user' ? 'You' : 'AI-Sheet Agent'}
          </div>
          <div
            className="whitespace-pre-wrap rounded-lg border p-3 text-sm leading-relaxed"
            style={{
              background: message.isError
                ? 'rgba(224, 140, 140, 0.1)'
                : message.role === 'assistant'
                  ? 'var(--surface)'
                  : 'transparent',
              borderColor: message.isError ? 'rgba(224, 140, 140, 0.3)' : 'var(--border)',
              color: message.isError ? 'var(--error)' : 'var(--ink)',
            }}
          >
            {message.role === 'user' ? (
              <UserMessage message={message} />
            ) : (
              <>
                {message.isError ? (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--error)' }} />
                    <span className="whitespace-pre-wrap">{message.content}</span>
                  </div>
                ) : (
                  <MarkdownRenderer
                    content={message.content}
                    isStreaming={message.isStreaming}
                  />
                )}
              </>
            )}
          </div>
          {!message.isStreaming && (
            <div className="flex justify-end gap-1">
              {message.role === 'assistant' && (
                <RetryButton messageId={message.id} />
              )}
              <DeleteButton messageId={message.id} />
              <CopyButton text={message.fullContent ?? message.content} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
