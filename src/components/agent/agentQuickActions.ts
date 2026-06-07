import type { Prompt } from '../../types/prompt';
import type { AgentContext } from '../../types/agent';
import type { DirectLlmContext } from '../../services/tauri';

export const TEMPLATE_NAMES = {
  formula_generation: 'Excel公式生成',
  prompt_generation: '提示词生成',
} as const;

export type QuickAction = keyof typeof TEMPLATE_NAMES;

export const FALLBACK_TEMPLATES: Record<QuickAction, string> = {
  formula_generation: `你是一名顶级的Excel数据分析专家与顾问，不仅精通所有Excel函数、数据处理技巧、VBA和Power Query，更重要的是，你深谙数据处理的**健壮性、性能优化和可维护性**。你的核心任务是根据用户提供的需求，为其生成精确、高效、稳健的Excel公式，并提供百科全书式的清晰解释。

**你的工作流程严格遵循以下步骤：**

1. **确认并重述需求**：在回答的开头，必须先用一两句话清晰地重述你对用户需求的理解。

2. **分析需求并提供思路**：如果用户需求涉及多个数据列的交互、复杂的逻辑判断、或组合使用多个函数，你**必须**先提供一个名为【**公式编写思路**】的部分。

3. **提供公式**：在名为【**Excel公式**】的标题下，使用代码块格式，清晰地展示最终的Excel公式。请确保公式的准确性，并提示用户应在哪个单元格输入以及如何填充。

4. **注意事项与版本差异**：如果公式涉及绝对/相对引用、数组公式/动态数组、跨工作表/工作簿引用，**必须**添加此部分对关键细节进行说明。

5. **详细解释公式**：在名为【**公式详细解释**】的标题下，对你提供的公式进行由内到外或按执行顺序的拆解说明。

6. **展示应用结果**：如果用户在需求中提供了样本数据，你**必须**在最后提供一个名为【**样例数据执行结果**】的部分，创建Markdown表格展示计算结果。`,
  prompt_generation: `# 角色 (Role)

你是一位世界顶级的提示词工程专家（Prompt Engineering Expert），精通大型语言模型（LLM）的内部工作原理、行为模式和优化策略。你的核心任务是将用户提供的零散、非结构化的需求，转化为一份逻辑清晰、结构完整、指令明确、能够最大限度激发LLM性能的"结构化提示词"。

# 背景 (Background)

用户希望创建一个高效的提示词来完成特定任务，但他们可能不熟悉提示词工程的最佳实践。你的存在是为了弥合这一差距，通过一个标准化的流程，将用户的意图转化为机器可精确理解和执行的指令集。

# 核心能力 (Core Competencies)

1. **结构化思维**：你能将复杂需求拆解为独立的、有逻辑关联的组成部分。
2. **语义理解与重构**：你善于捕捉用户输入的真实意图，并用更精确、无歧义的语言重新组织和表述。
3. **上下文构建**：你能将用户提供的所有信息融合成一个连贯的上下文。
4. **样例驱动学习**：你深刻理解样例在提示词中的关键作用。
5. **格式化输出设计**：你能够根据用户的输出要求设计出清晰的输出指令。

# 工作流程 (Workflow)

1. **接收与解析输入**：仔细阅读用户提供的所有字段信息。
2. **综合分析与提炼**：融合上下文、清晰化指令、规则化样例、具象化输出、明确化约束。
3. **构建结构化提示词**：按照标准结构，将提炼后的内容组织成一个完整的提示词。
4. **优化与增强**：主动添加能提升效果的最佳实践。

# 输出格式

你的最终输出必须包含完整的、可直接使用的结构化提示词，使用Markdown进行格式化。`,
};

export function findPromptTemplate(
  prompts: Prompt[],
  action: QuickAction,
): { template: string; usedFallback: boolean } {
  const target = TEMPLATE_NAMES[action];
  const hit = prompts.find((p) => p.name === target);
  if (hit) return { template: hit.content, usedFallback: false };
  return { template: FALLBACK_TEMPLATES[action], usedFallback: true };
}

export function buildDisplaySummary(
  action: QuickAction,
  ctx: DirectLlmContext,
  usedFallback: boolean,
  sampleMissing: boolean,
): string {
  const prefix = usedFallback ? '[已使用默认模板] ' : '';
  const actionLabel = action === 'formula_generation' ? '公式生成' : '提示词生成';
  const sheets = ctx.sheets.map((s) => s.sheet).join(', ');
  const allCols = [...new Set(ctx.sheets.flatMap((s) => s.columns))].join(', ');
  const suffix = sampleMissing ? ' · 未加载样例预览' : '';
  return `${prefix}${actionLabel} · ${ctx.fileName} · Sheet: ${sheets} · 列: ${allCols}${suffix}`;
}

export function buildDirectPrompt(
  action: QuickAction,
  template: string,
  ctx: DirectLlmContext,
): string {
  const header =
    action === 'formula_generation'
      ? `# 任务：生成 Excel 公式\n\n请基于下方 Excel 上下文，仅输出可粘贴到目标单元格的 Excel 公式；` +
        `行号占位符 \`{}\` 会被替换为实际行号（如 \`=A{}+B{}\` 展开为 \`=A2+B2\`）。`
      : `# 任务：生成提示词模板\n\n请基于下方 Excel 上下文，生成适合批量处理当前行数据的提示词模板，输出列、格式与约束需明确。`;

  const contextBlock = formatContext(ctx);
  return `${template}\n\n${header}\n\n---\n# Excel 上下文\n${contextBlock}`;
}

function formatContext(ctx: DirectLlmContext): string {
  const lines: string[] = [];
  lines.push(`文件: ${ctx.fileName}`);
  if (ctx.sheets.length > 0) {
    lines.push(`Sheet: ${ctx.sheets.map((s) => s.sheet).join(', ')}`);
    for (const sheet of ctx.sheets) {
      if (sheet.columns.length > 0) {
        lines.push(`列(${sheet.sheet}): ${sheet.columns.join(', ')}`);
      }
    }
  }
  if (ctx.samplePreview) {
    lines.push('');
    lines.push('样例数据（前 5 行）:');
    lines.push(ctx.samplePreview);
  } else {
    lines.push('');
    lines.push('(未加载样例预览，请基于列名推断)');
  }
  return lines.join('\n');
}
