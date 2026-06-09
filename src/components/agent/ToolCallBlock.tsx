/**
 * 工具调用展示组件
 * 可折叠的工具调用卡片，显示工具名称、状态、参数和结果
 */

import { ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { ToolCall } from '../../types/agent';

// 工具图标映射
const TOOL_ICONS: Record<string, string> = {
  read_excel: '📄',
  write_excel: '📝',
  apply_formula: '🔢',
  get_config: '⚙️',
  test_connection: '🔗',
  get_prompts: '📋',
  save_prompt: '💾',
  start_batch: '▶️',
  pause_batch: '⏸️',
  get_batch_status: '📊',
  bash: '💻',
  read: '📄',
  write: '📝',
  edit: '✏️',
  glob: '📁',
  grep: '🔍',
};

// 工具名称标签映射
const TOOL_LABELS: Record<string, string> = {
  read_excel: '读取 Excel',
  write_excel: '写入 Excel',
  apply_formula: '应用公式',
  get_config: '获取配置',
  test_connection: '测试连接',
  get_prompts: '获取提示词',
  save_prompt: '保存提示词',
  start_batch: '启动批量处理',
  pause_batch: '暂停批量',
  get_batch_status: '查询批量状态',
  bash: '执行命令',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  glob: '搜索文件',
  grep: '搜索内容',
};

function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] || tool;
}

function getToolIcon(tool: string): string {
  return TOOL_ICONS[tool] || '🔧';
}

// 状态指示器
function StatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'running' || status === 'pending') {
    return (
      <Loader2
        className="h-3.5 w-3.5 animate-spin"
        style={{ color: 'var(--primary)' }}
      />
    );
  }
  if (status === 'completed') {
    return (
      <CheckCircle
        className="h-3.5 w-3.5"
        style={{ color: 'var(--success)' }}
      />
    );
  }
  return (
    <XCircle
      className="h-3.5 w-3.5"
      style={{ color: 'var(--error)' }}
    />
  );
}

// 截断过长的工具输出
const MAX_RETAINED_TOOL_OUTPUT_CHARS = 20_000;

function truncateOutput(output: string | undefined): string | undefined {
  if (!output || output.length <= MAX_RETAINED_TOOL_OUTPUT_CHARS) return output;
  const omitted = output.length - MAX_RETAINED_TOOL_OUTPUT_CHARS;
  return [
    output.slice(0, MAX_RETAINED_TOOL_OUTPUT_CHARS),
    `[输出已截断，省略 ${omitted} 字符]`,
  ].join('\n\n');
}

interface ToolCallCardProps {
  toolCall: ToolCall;
}

function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails = (toolCall.args && Object.keys(toolCall.args).length > 0) || toolCall.result;
  const icon = getToolIcon(toolCall.tool);
  const label = getToolLabel(toolCall.tool);
  const truncatedResult = truncateOutput(toolCall.result);

  const handleToggle = useCallback(() => {
    if (hasDetails) setExpanded((e) => !e);
  }, [hasDetails]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  }, [handleToggle]);

  return (
    <div
      className="tool-call-card"
      data-status={toolCall.status}
    >
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent text-left"
        style={{ padding: '6px 10px' }}
        aria-expanded={expanded}
        disabled={!hasDetails}
      >
        <span className="shrink-0 text-xs">{icon}</span>
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="h-3 w-3" style={{ color: 'var(--muted)' }} />
          ) : (
            <ChevronRight className="h-3 w-3" style={{ color: 'var(--muted)' }} />
          )
        ) : null}
        <span className="flex-1 truncate text-xs" style={{ color: 'var(--ink)' }}>
          {label}
        </span>
        <StatusIcon status={toolCall.status} />
      </button>

      <div className="tool-call-content" data-expanded={expanded}>
        <div className="tool-call-content-inner">
          {expanded && (
            <div style={{ padding: '0 10px 8px' }}>
              {toolCall.args && Object.keys(toolCall.args).length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>
                    参数
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      margin: 0,
                      padding: '4px 6px',
                      borderRadius: 4,
                      background: 'var(--bg)',
                      color: 'var(--ink)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(toolCall.args, null, 2)}
                  </pre>
                </div>
              )}
              {truncatedResult && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>
                    结果
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      margin: 0,
                      padding: '4px 6px',
                      borderRadius: 4,
                      background: 'var(--bg)',
                      color: toolCall.status === 'error' ? 'var(--error)' : 'var(--ink)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {truncatedResult}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ToolCallsBlockProps {
  toolCalls: ToolCall[];
}

export function ToolCallsBlock({ toolCalls }: ToolCallsBlockProps) {
  const [expanded, setExpanded] = useState(true);

  if (!toolCalls || toolCalls.length === 0) return null;

  const hasPending = toolCalls.some((tc) => tc.status === 'running' || tc.status === 'pending');

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 transition-colors"
        style={{ fontSize: 12, padding: '4px 0', color: 'var(--muted)' }}
        aria-expanded={expanded}
      >
        <span>🔧</span>
        <span>工具调用</span>
        <span
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full ${hasPending ? 'animate-pulse' : ''}`}
          style={{
            background: 'var(--surface)',
            fontSize: 10,
            fontWeight: 600,
            padding: '0 5px',
            color: 'var(--muted)',
          }}
        >
          {toolCalls.length}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div style={{ marginTop: 4 }}>
          {toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
