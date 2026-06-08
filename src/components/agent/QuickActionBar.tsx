import { Sigma, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { usePromptStore } from '../../stores/promptStore';
import { findPromptTemplate, buildDirectPrompt, buildDisplaySummary, type QuickAction } from './agentQuickActions';

interface QuickActionBarProps {
  agentInput: string;
  onAgentInputChange: (value: string) => void;
  onSetQuickPlaceholder: (placeholder: string | null) => void;
}

const PLACEHOLDER_HINTS: Record<QuickAction, string> = {
  formula_generation: '请输入你想生成的公式，例如：根据销售额和成本计算利润率',
  prompt_generation: '请输入你想生成的提示词需求，例如：对每行数据进行情感分类并输出JSON',
};

export function QuickActionBar({ agentInput, onAgentInputChange, onSetQuickPlaceholder }: QuickActionBarProps) {
  const status = useAgentStore((s) => s.status);
  const directStreamingRequestId = useAgentStore((s) => s.directStreamingRequestId);
  const appliedModelName = useAgentStore((s) => s.appliedModelName);
  const sendDirectLlmMessage = useAgentStore((s) => s.sendDirectLlmMessage);
  const loadedContext = useAgentStore((s) => s.loadedContext);

  const selections = useExcelStore((s) => s.selections);
  const previewData = useExcelStore((s) => s.previewData);

  const prompts = usePromptStore((s) => s.prompts);

  const hasExcel = (loadedContext?.loadedFiles?.length ?? 0) > 0;
  const isDirectStreaming = directStreamingRequestId !== null;
  const isReady = status?.ready ?? false;
  const canClick = hasExcel && !!appliedModelName && !isDirectStreaming && isReady;

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (!canClick || !loadedContext?.loadedFiles?.length) return;

      const input = agentInput.trim();

      // 空输入：聚焦输入框 + 提示 placeholder
      if (!input) {
        onSetQuickPlaceholder(PLACEHOLDER_HINTS[action]);
        const el = document.querySelector<HTMLTextAreaElement>('[data-ai-input]');
        el?.focus();
        return;
      }

      // 有输入：组合三部分发送
      const { template, usedFallback } = findPromptTemplate(prompts, action);

      const first = loadedContext.loadedFiles[0];
      const sel = selections.find((s) => s.file.path === first.path);
      const activeSheet = first.sheets[0]?.sheetName;

      // Use sampleDataPreview from loadedContext if available, otherwise build from store
      let previewStr: string | undefined;
      let sampleMissing = false;
      if (loadedContext.sampleDataPreview) {
        previewStr = loadedContext.sampleDataPreview;
      } else {
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

      const displaySummary = buildDisplaySummary(action, ctx, usedFallback, sampleMissing, input);
      const fullPrompt = buildDirectPrompt(action, template, ctx, input);

      // 清空输入后再发送
      onAgentInputChange('');
      onSetQuickPlaceholder(null);

      sendDirectLlmMessage(action, displaySummary, fullPrompt).catch(() => {});
    },
    [
      canClick,
      loadedContext,
      agentInput,
      prompts,
      selections,
      previewData,
      onAgentInputChange,
      onSetQuickPlaceholder,
      sendDirectLlmMessage,
    ],
  );

  if (!isReady) return null;

  return (
    <div className="flex gap-2 px-3 pb-2">
      <button
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
                    ? '结合输入需求 + Excel 上下文生成公式'
                    : '请先在输入框输入具体公式需求'
        }
        onClick={() => handleQuickAction('formula_generation')}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--ink)',
          background: 'var(--surface)',
        }}
      >
        <Sigma className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
        公式生成
      </button>
      <button
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
                    ? '结合输入需求 + Excel 上下文生成提示词'
                    : '请先在输入框输入具体提示词需求'
        }
        onClick={() => handleQuickAction('prompt_generation')}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--ink)',
          background: 'var(--surface)',
        }}
      >
        <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
        提示词生成
      </button>
    </div>
  );
}
