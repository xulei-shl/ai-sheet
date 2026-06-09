# 计划：移除 PythonProcessingPage，Python 处理委托给 PI Agent Skill

## Context

当前 `PythonProcessingPage.tsx` 是一个非功能性 stub（用 `AsyncFunction` 在浏览器中执行 JavaScript，不是真正的 Python）。根据 DESIGN.md 设计，Python 处理应完全由 PI agent 完成：用户在右侧 AI 面板对话，agent 编写 Python 脚本，通过 bash 执行，自动修复错误，直到成功。

## 方案选择：Skill（而非 Subagent 或 Extension）

- **Skill**：正确选择。Python 处理是已有工具（bash、read_excel、write_excel）的工作流指导，不需要新工具或隔离的上下文窗口。Skill 提供 progressive disclosure（仅描述常驻系统提示，完整指令按需加载）。
- **Subagent（agent.md）**：不适合。Subagent 运行在隔离进程中，破坏多轮对话流程，且无法共享已 steer 的 Excel 上下文。
- **Extension**：过度设计。不需要新工具或事件拦截。

## 实施步骤

### Step 1：创建 `.pi/skills/python-processing/SKILL.md`

**新文件**：`.pi/skills/python-processing/SKILL.md`

内容包含：
- YAML frontmatter：`name: python-processing`，`description` 明确说明使用场景
- 工作流 6 步：了解数据 → 确认需求 → 编写脚本 → 执行 → 检查结果（成功/出错重试）→ 写入 Excel
- 脚本模板（pandas + openpyxl）
- 最佳实践（raw string 路径、编码处理、大文件分块、保存前备份等）
- 常见错误模式表（FileNotFoundError、UnicodeDecodeError、KeyError、PermissionError、ModuleNotFoundError）
- 错误重试上限（同一脚本最多自动修复 3 次）

Skill 发现机制：PI 框架自动扫描 `.pi/skills/`（相对于 `createAgentSession` 的 `cwd`）。Sidecar 从项目根目录启动（`sidecar_manager.rs:282-288` 确认），因此 `.pi/skills/` 会被正确发现。

### Step 2：修改 `src/pages/AiPage.tsx`

1. 移除 `PythonProcessingPage` 的 import（第 4 行）
2. 从 `AiSubTab` 类型中移除 `'python'`（第 6 行）
3. 删除 `subTab === 'python'` 的整个条件渲染块（第 35-48 行）
4. 在 `subTab === 'llm-batch'` 视图的面包屑中，移除 "Python 处理" 按钮（第 27-28 行的 ChevronRight + button）
5. 在 landing page（`prompt-gen`）视图的面包屑中，移除 "Python 处理" 按钮（第 56-57 行）
6. 将 Python 卡片从 `<button>` 改为 `<div>`（纯信息展示），文案改为"在右侧 AI 面板中对话..."，移除 ChevronRight 和 onClick

### Step 3：删除 `src/pages/PythonProcessingPage.tsx`

Step 2 完成后，此文件不再被任何地方引用，直接删除。

### Step 4（可选）：更新系统提示 `src-agent/src/prompts/system.ts`

系统提示第 32 行已有 Python 能力说明。PI 框架在 skill 发现时会自动在系统提示中添加可用 skill 的描述，因此显式提及 `/skill:python-processing` 仅是增强可发现性，非必需。

## 涉及文件

| 文件 | 操作 |
|------|------|
| `.pi/skills/python-processing/SKILL.md` | 新建 |
| `src/pages/AiPage.tsx` | 修改（移除 python 子标签、改卡片为信息展示） |
| `src/pages/PythonProcessingPage.tsx` | 删除 |
| `src-agent/src/prompts/system.ts` | 可选修改 |

## 验证方式

1. `npx tsc --noEmit` 确认 TypeScript 编译无报错
2. `npm run build` 确认构建成功
3. 启动应用后，AI 页面 landing page 应只有 2 个可导航子标签（提示词生成、LLM 批量处理），Python 卡片为信息展示（不可点击跳转）
4. 在右侧 AI 面板输入 Python 相关请求，agent 应能识别并使用 skill 工作流
