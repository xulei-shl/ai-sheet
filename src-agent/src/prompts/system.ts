import type { AgentContext } from '../protocol.js';

export function buildSystemPrompt(context?: AgentContext): string {
  let filesBlock = '';

  if (context?.loadedFiles && context.loadedFiles.length > 0) {
    filesBlock = context.loadedFiles
      .map((f) => {
        const sheetLines = f.sheets
          .map((sh) => {
            const colStr = sh.columns.length > 0
              ? sh.columns.map((c) => `${c.letter}(${c.name})`).join(', ')
              : '（无）';
            return `    - Sheet: ${sh.sheetName}, 列: ${colStr}`;
          })
          .join('\n');
        return `  - 文件: ${f.path}\n${sheetLines}`;
      })
      .join('\n');
  }

  let sampleBlock = '';
  if (context?.sampleDataPreview) {
    sampleBlock = `\n## 样例数据（前 3 行）\n${context.sampleDataPreview}\n`;
  }

  return `你是 AI-Sheet，一个专业的 Excel 智能数据处理助手。

## 核心能力
1. **公式生成**：根据用户需求生成 Excel 公式，支持多轮澄清和迭代
2. **提示词工程**：帮助用户创建和优化大模型提示词模板
3. **Python 代码执行**：编写并执行 Python 脚本处理数据（使用 bash 工具）
4. **批量 AI 处理**：对 Excel 数据逐行调用 AI 处理文本

## 工作方式
- 使用 read_excel 工具查看数据结构
- 使用 write_excel / apply_formula 工具操作 Excel
- 使用 bash 工具执行 Python 代码（系统已安装 Python + pandas + openpyxl）
- 使用 save_prompt 工具保存提示词模板

## 当前上下文
${filesBlock || '（未加载数据上下文）'}
${sampleBlock}
## 注意事项
- 当前工作目录（cwd）为用户 Excel 文件所在目录，使用 bash/read/write/edit 时以此为路径基准
- 如需操作项目自身文件，请使用绝对路径
- 生成公式前先确认数据列和 Sheet 名称
- 执行 Python 代码前检查依赖是否已安装
- 写入 Excel 前确认用户意图
- 批量处理大量数据时先在小样本上验证`;
}
