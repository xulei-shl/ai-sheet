import type { Prompt } from '../../types/prompt';
import type { DirectLlmContext } from '../../services/tauri';

// ── Constants ──────────────────────────────────────────────

export const QUICK_ACTION_CATEGORY = '快捷操作';

// ── Icon & Placeholder mappings ────────────────────────────

const ICON_MAP: Record<string, string> = {
  'Excel公式生成': 'sigma',
  '提示词生成': 'sparkles',
};

const PLACEHOLDER_MAP: Record<string, string> = {
  'Excel公式生成': '请输入你想生成的公式，例如：根据销售额和成本计算利润率',
  '提示词生成': '请输入你想生成的提示词需求，例如：对每行数据进行情感分类并输出JSON',
};

const DEFAULT_ICON = 'zap';
const DEFAULT_PLACEHOLDER = '请输入你的需求';

export function getIconNameForPrompt(name: string): string {
  return ICON_MAP[name] ?? DEFAULT_ICON;
}

export function getPlaceholderForPrompt(name: string): string {
  return PLACEHOLDER_MAP[name] ?? DEFAULT_PLACEHOLDER;
}

// ── Quick action prompt filtering ──────────────────────────

const LEGACY_QUICK_ACTION_NAMES = ['Excel公式生成', '提示词生成'];

export function getQuickActionPrompts(prompts: Prompt[]): Prompt[] {
  // Primary: filter by category
  const byCategory = prompts.filter((p) => p.category === QUICK_ACTION_CATEGORY);
  if (byCategory.length > 0) {
    return byCategory.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  // Fallback: match by legacy names (for backward compatibility before seed runs)
  const byName = prompts.filter((p) => LEGACY_QUICK_ACTION_NAMES.includes(p.name));
  return byName.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

// ── Prompt construction ────────────────────────────────────

export function buildDirectPrompt(
  template: string,
  ctx: DirectLlmContext,
  userInput: string,
): string {
  const contextBlock = formatContext(ctx);
  return `你是一个专业的 Excel 助手。

# 当前 Excel 上下文
${contextBlock}

# 用户具体需求
${userInput}

---
${template}`;
}

export function buildDisplaySummary(
  actionName: string,
  ctx: DirectLlmContext,
  usedFallback: boolean,
  sampleMissing: boolean,
  userInput: string,
): string {
  const prefix = usedFallback ? '[已使用默认模板] ' : '';
  const truncated = userInput.length > 60 ? userInput.slice(0, 60) + '...' : userInput;
  const sheets = ctx.sheets.map((s) => s.sheet).join(', ');
  const allCols = [...new Set(ctx.sheets.flatMap((s) => s.columns))].join(', ');
  const fileNameShort = ctx.fileName.split('\\').pop()?.split('/').pop() ?? ctx.fileName;
  const suffix = sampleMissing ? ' · 未加载样例预览' : '';
  return `${prefix}${actionName} · 「${truncated}」 · ${fileNameShort} · Sheet: ${sheets} · 列: ${allCols}${suffix}`;
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
    lines.push('样例数据（前 3 行）:');
    lines.push(ctx.samplePreview);
  }
  return lines.join('\n');
}
