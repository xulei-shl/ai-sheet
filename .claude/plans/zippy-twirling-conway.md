# 修复快捷 LLM 调用未从提示词管理加载模板

## Context

用户发现快捷按钮（公式生成、提示词生成）点击后拼接的提示词是硬编码的 fallback 模板，而不是从"提示词管理"中加载同名模板。

**根因分析：**

- `QuickActionBar.tsx` 第 29 行读取 `usePromptStore((s) => s.prompts)`
- 但 `fetchPrompts()` 只在 `PromptsPage` 和 `LLMProcessingPage` 中调用
- `AgentChatPanel.tsx` **从未调用 `fetchPrompts()`**
- 因此当用户在 Agent 页面时，`prompts` 数组是空的 `[]`
- `findPromptTemplate()` 永远返回 `usedFallback: true`

## Implementation Plan

### 修改文件

- [ ] `src/components/agent/AgentChatPanel.tsx` —— 在组件挂载时调用 `fetchPrompts()`

### 具体改动

在 `AgentChatPanel.tsx` 中：

```tsx
// 新增 import
import { usePromptStore } from '../../stores/promptStore';

// 在组件函数内部
const fetchPrompts = usePromptStore((s) => s.fetchPrompts);

// 在 useEffect 中添加
useEffect(() => {
  void refreshStatus();
  void fetchPrompts();  // 新增：加载提示词库

  // ... 其余不变
}, [handleEvent, markOffline, refreshStatus, fetchPrompts]);
```

## Verification

1. 启动应用 `npm run tauri dev`
2. 直接进入 Agent 页面（不访问提示词管理页）
3. 加载 Excel 文件，选择模型
4. 在输入框输入需求，点击"公式生成"
5. 检查聊天记录中用户消息是否显示 `[已使用默认模板]` 前缀
   - 如果**有**此前缀 → 仍然 fallback（说明提示词管理中无同名模板或加载失败）
   - 如果**没有**此前缀 → 成功从提示词管理加载
6. 可选：在"提示词管理"中修改"Excel公式生成"模板内容，再次测试，确认使用的是修改后的内容
