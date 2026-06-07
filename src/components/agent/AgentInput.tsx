import { Send, Square } from 'lucide-react';
import { FormEvent, KeyboardEvent, useState } from 'react';

interface AgentInputProps {
  disabled?: boolean;
  isStreaming?: boolean;
  onSend: (content: string) => Promise<void>;
}

export function AgentInput({ disabled, isStreaming, onSend }: AgentInputProps) {
  const [content, setContent] = useState('');

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

  return (
    <form onSubmit={handleSubmit} className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
      <label className="sr-only" htmlFor="agent-input">
        输入给 AI-Sheet Agent 的消息
      </label>
      <div className="flex gap-2">
        <textarea
          id="agent-input"
          data-ai-input="true"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={disabled || isStreaming}
          rows={2}
          placeholder="描述你想处理的数据任务..."
          className="min-h-12 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          disabled={disabled || isStreaming || !content.trim()}
          className="inline-flex w-12 items-center justify-center rounded-md transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          aria-label={isStreaming ? '正在生成' : '发送消息'}
        >
          {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        Ctrl/⌘ + Enter 发送
      </p>
    </form>
  );
}
