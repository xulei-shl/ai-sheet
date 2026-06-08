import { Sigma, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { usePromptStore } from '../../stores/promptStore';
import {
  getQuickActionPrompts,
  getIconNameForPrompt,
  getPlaceholderForPrompt,
  buildDisplaySummary,
  buildDirectPrompt,
} from './agentQuickActions';
import type { Prompt } from '../../types/prompt';

interface QuickActionBarProps {
  agentInput: string;
  onAgentInputChange: (value: string) => void;
  onSetQuickPlaceholder: (placeholder: string | null) => void;
}

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  sigma: Sigma,
  sparkles: Sparkles,
  zap: Zap,
};

function resolveIcon(prompt: Prompt): LucideIcon {
  const name = getIconNameForPrompt(prompt.name);
  return ICON_COMPONENTS[name] ?? Zap;
}

export function QuickActionBar({ agentInput, onAgentInputChange, onSetQuickPlaceholder }: QuickActionBarProps) {
  const status = useAgentStore((s) => s.status);
  const directStreamingRequestId = useAgentStore((s) => s.directStreamingRequestId);
  const appliedModelName = useAgentStore((s) => s.appliedModelName);
  const sendDirectLlmMessage = useAgentStore((s) => s.sendDirectLlmMessage);
  const loadedContext = useAgentStore((s) => s.loadedContext);

  const selections = useExcelStore((s) => s.selections);
  const previewData = useExcelStore((s) => s.previewData);
  const includeSampleData = useExcelStore((s) => s.includeSampleData);

  const prompts = usePromptStore((s) => s.prompts);

  const quickActions = useMemo(() => getQuickActionPrompts(prompts), [prompts]);

  const hasExcel = (loadedContext?.loadedFiles?.length ?? 0) > 0;
  const isDirectStreaming = directStreamingRequestId !== null;
  const isReady = status?.ready ?? false;
  const canClick = hasExcel && !!appliedModelName && !isDirectStreaming && isReady;

  const handleQuickAction = useCallback(
    (prompt: Prompt) => {
      if (!canClick || !loadedContext?.loadedFiles?.length) return;

      const input = agentInput.trim();

      // 空输入：聚焦输入框 + 提示 placeholder
      if (!input) {
        onSetQuickPlaceholder(getPlaceholderForPrompt(prompt.name));
        const el = document.querySelector<HTMLTextAreaElement>('[data-ai-input]');
        el?.focus();
        return;
      }

      // 有输入：组合三部分发送
      const first = loadedContext.loadedFiles[0];
      const sel = selections.find((s) => s.file.path === first.path);
      const activeSheet = first.sheets[0]?.sheetName;

      // Use sampleDataPreview from loadedContext if available and includeSampleData is true
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

      // 清空输入后再发送
      onAgentInputChange('');
      onSetQuickPlaceholder(null);

      sendDirectLlmMessage(prompt.id, displaySummary, fullPrompt).catch(() => {});
    },
    [
      canClick,
      loadedContext,
      agentInput,
      selections,
      previewData,
      includeSampleData,
      onAgentInputChange,
      onSetQuickPlaceholder,
      sendDirectLlmMessage,
    ],
  );

  if (!isReady || quickActions.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 pb-2">
      {quickActions.map((prompt) => {
        const Icon = resolveIcon(prompt);
        return (
          <button
            key={prompt.id}
            type="button"
            disabled={!canClick}
            title={
              !hasExcel
                ? '请先在左侧加载 Excel 文件'
                : !appliedModelName
                  ? '请先在 Agent 输入框选择模型'
                  : !isReady
                    ? 'Sidecar 未就绪'
                    : isDirectStreaming
                      ? '正在生成中...'
                      : agentInput.trim()
                        ? `结合输入需求 + Excel 上下文 · ${prompt.name}`
                        : `请先在输入框输入具体需求 · ${prompt.name}`
            }
            onClick={() => handleQuickAction(prompt)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--ink)',
              background: 'var(--surface)',
            }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
            {prompt.name}
          </button>
        );
      })}
    </div>
  );
}
