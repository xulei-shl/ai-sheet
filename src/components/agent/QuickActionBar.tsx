import { Sigma, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useExcelStore } from '../../stores/excelStore';
import { usePromptStore } from '../../stores/promptStore';
import { findPromptTemplate, buildDirectPrompt, buildDisplaySummary, type QuickAction } from './agentQuickActions';

export function QuickActionBar() {
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

      const { template, usedFallback } = findPromptTemplate(prompts, action);

      const first = loadedContext.loadedFiles[0];
      const sel = selections.find((s) => s.file.name === first.name);
      const activeSheet = first.sheets[0]?.sheetName;

      const samplePreview = activeSheet
        ? sel?.previewData?.[activeSheet] ?? previewData
        : null;

      let previewStr: string | undefined;
      let sampleMissing = false;
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

      const ctx = {
        fileName: first.name,
        sheets: first.sheets.map((s) => ({ sheet: s.sheetName, columns: s.columns })),
        samplePreview: previewStr,
      };

      const displaySummary = buildDisplaySummary(action, ctx, usedFallback, sampleMissing);
      const fullPrompt = buildDirectPrompt(action, template, ctx);

      sendDirectLlmMessage(action, displaySummary, fullPrompt).catch(() => {});
    },
    [
      canClick,
      loadedContext,
      prompts,
      selections,
      previewData,
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
                  : '基于当前 Excel 上下文生成公式'
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
                  : '基于当前 Excel 上下文生成提示词'
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
