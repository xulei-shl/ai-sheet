import { Sigma, Sparkles, AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { usePromptStore } from '../../stores/promptStore';
import {
  findPromptByName,
  getPlaceholderForPrompt,
  buildDisplaySummary,
  buildDirectPrompt,
  QUICK_ACTION_NAMES,
  QUICK_ACTION_LABELS,
} from './agentQuickActions';

interface QuickActionBarProps {
  agentInput: string;
  onAgentInputChange: (value: string) => void;
  onSetQuickPlaceholder: (placeholder: string | null) => void;
}

const QUICK_BUTTONS = [
  { key: 'formula', name: QUICK_ACTION_NAMES.formula, label: QUICK_ACTION_LABELS.formula, icon: Sigma },
  { key: 'prompt', name: QUICK_ACTION_NAMES.prompt, label: QUICK_ACTION_LABELS.prompt, icon: Sparkles },
] as const;

export function QuickActionBar({ agentInput, onAgentInputChange, onSetQuickPlaceholder }: QuickActionBarProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);
  const status = useAgentStore((s) => s.status);
  const agentStreamingRequestId = useAgentStore((s) => s.agentStreamingRequestId);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const loadedContext = useAgentStore((s) => s.loadedContext);

  const selections = useExcelStore((s) => s.selections);
  const previewData = useExcelStore((s) => s.previewData);
  const includeSampleData = useExcelStore((s) => s.includeSampleData);

  const prompts = usePromptStore((s) => s.prompts);

  const hasExcel = (loadedContext?.loadedFiles?.length ?? 0) > 0;
  const isStreaming = agentStreamingRequestId !== null;
  const isReady = status?.ready ?? false;
  const canClick = hasExcel && !isStreaming && isReady;

  const handleQuickAction = useCallback(
    (promptName: string) => {
      if (!canClick || !loadedContext?.loadedFiles?.length) return;

      const input = agentInput.trim();

      // 空输入：聚焦输入框 + 提示 placeholder
      if (!input) {
        onSetQuickPlaceholder(getPlaceholderForPrompt(promptName));
        const el = document.querySelector<HTMLTextAreaElement>('[data-ai-input]');
        el?.focus();
        return;
      }

      // 从 DB 查找提示词模板
      const prompt = findPromptByName(prompts, promptName);
      if (!prompt) {
        setFeedback(`提示词模板「${promptName}」未找到，请先在提示词管理中创建`);
        return;
      }

      // 有输入：组合三部分发送
      const first = loadedContext.loadedFiles[0];
      const sel = selections.find((s) => s.file.path === first.path);
      const activeSheet = first.sheets[0]?.sheetName;

      let previewStr: string | undefined;
      let sampleMissing = false;
      if (loadedContext.sampleDataPreview) {
        previewStr = loadedContext.sampleDataPreview;
      } else if (includeSampleData) {
        const samplePreview = activeSheet
          ? sel?.previewData?.[activeSheet] ?? previewData
          : null;
        if (samplePreview && samplePreview.rows && samplePreview.rows.length > 0) {
          const cols = samplePreview.columns;
          const head = samplePreview.rows.slice(0, 5);
          const header = '| ' + cols.join(' | ') + ' |';
          const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
          const body = head
            .map((r) => '| ' + cols.map((c) => String(r[c] ?? '')).join(' | ') + ' |')
            .join('\n');
          previewStr = `${header}\n${sep}\n${body}`;
        } else {
          sampleMissing = true;
        }
      }

      const ctx = {
        fileName: first.path,
        sheets: first.sheets.map((s) => ({ sheet: s.sheetName, columns: s.columns.map((c) => `${c.letter}(${c.name})`) })),
        samplePreview: previewStr,
      };

      const displaySummary = buildDisplaySummary(prompt.name, ctx, false, sampleMissing, input);
      const fullPrompt = buildDirectPrompt(prompt.content, ctx, input);

      // 清空输入后通过 agent 消息发送
      onAgentInputChange('');
      onSetQuickPlaceholder(null);

      sendMessage(input, displaySummary, fullPrompt).catch(() => {});
    },
    [
      canClick,
      loadedContext,
      agentInput,
      selections,
      previewData,
      includeSampleData,
      prompts,
      onAgentInputChange,
      onSetQuickPlaceholder,
      sendMessage,
    ],
  );

  if (!isReady) return null;

  return (
    <div className="flex flex-col gap-1">
      {feedback && (
        <div className="flex items-center gap-1.5 px-3 text-xs" style={{ color: 'var(--error)' }}>
          <AlertCircle className="h-3 w-3 shrink-0" />
          {feedback}
        </div>
      )}
      <div className="flex gap-2 px-3 pb-2">
      {QUICK_BUTTONS.map(({ key, name, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          disabled={!canClick}
          title={
            !hasExcel
              ? '请先在左侧加载 Excel 文件'
              : !isReady
                ? 'Sidecar 未就绪'
                : isStreaming
                  ? '正在生成中...'
                  : agentInput.trim()
                    ? `结合输入需求 + Excel 上下文 · ${label}`
                    : `请先在输入框输入具体需求 · ${label}`
          }
          onClick={() => handleQuickAction(name)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--ink)',
            background: 'var(--surface)',
          }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
          {label}
        </button>
      ))}
      </div>
    </div>
  );
}
