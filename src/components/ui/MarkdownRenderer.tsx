import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { useState, useEffect } from 'react';
import type { Element } from 'hast';
import yaml from 'yaml';

function PreBlock({ children, node }: { children?: React.ReactNode; node?: Element }) {
  const codeNode = node?.children?.[0];
  const codeEl = codeNode?.type === 'element' ? codeNode : undefined;
  const raw = codeEl?.children?.[0];
  const codeText = raw?.type === 'text' ? raw.value : '';
  const code = codeText.replace(/\n$/, '');

  const props = codeEl?.properties ?? {};
  const classList = props.className;
  const classArr = Array.isArray(classList) ? classList.map(String) : [];
  const langClass = classArr.find((c) => c.startsWith('language-'));
  const language = langClass ? langClass.slice(9) : '';

  const [copied, setCopied] = useState(false);

  return (
    <div className="relative group my-2">
      <div
        className="flex items-center justify-between rounded-t-lg px-4 py-1 text-xs"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          color: 'var(--muted)',
        }}
      >
        <span>{language || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100!"
          style={{ color: 'var(--muted)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {copied ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </>
            )}
          </svg>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre
        style={{
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          marginTop: 0,
        }}
      >
        {children}
      </pre>
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  dense?: boolean;
  onFrontmatter?: (data: Record<string, unknown>) => void;
}

export function MarkdownRenderer({ content, className, isStreaming, dense, onFrontmatter }: MarkdownRendererProps) {
  useEffect(() => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match?.[1]) {
      try {
        const data = yaml.parse(match[1]);
        if (data && typeof data === 'object') onFrontmatter?.(data as Record<string, unknown>);
      } catch {}
    }
  }, [content, onFrontmatter]);

  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trimStart();

  return (
    <div className={`${className || ''} markdown-body${dense ? ' markdown-body--dense' : ''}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]} components={{ pre: PreBlock }}>
        {body}
      </ReactMarkdown>
      {isStreaming && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-1.5 align-[-2px]"
          style={{ background: 'var(--primary)' }}
        />
      )}
    </div>
  );
}
