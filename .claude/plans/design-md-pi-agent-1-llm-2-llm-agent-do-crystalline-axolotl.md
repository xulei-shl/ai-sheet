# 前端对话窗口交互优化

## Context

用户希望优化 AI Agent 对话窗口的交互体验：
1. **等待动效**：用户发送消息后到 LLM 返回流式输出之间，存在时间间隙，需要动效避免页面无响应感
2. **工具调用展示**：LLM 执行过程中可能有多次工具调用、思考等，需要对应的可折叠信息流 UI

**当前状态**：
- 类型定义已存在（`ToolCall`、`agent_tool_start/end` 事件），但前端未使用
- `agentStore.handleEvent` 只处理 `delta/done/error`，未处理工具事件
- `MessageList` 只渲染文本，无等待动效和工具调用 UI

**参考实现**：`docs/coding-agent-integration-reference/` 提供了完整的 typing dots、可折叠思考/工具调用 UI 模式

---

## Implementation Plan

### Step 1: 扩展类型定义

**文件**: `src/types/agent.ts`

```typescript
export interface ToolCall {
  id: string;              // 新增：唯一标识
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  startTime: number;       // 新增：开始时间
  endTime?: number;        // 新增：结束时间
}

export interface AgentMessage {
  // ... 现有字段
  toolCalls?: ToolCall[];
  isWaitingForFirstToken?: boolean;  // 新增：等待首个 token 状态
}
```

### Step 2: 更新 agentStore 处理工具事件

**文件**: `src/stores/agentStore.ts`

在 `handleEvent` 函数中添加：

```typescript
// agent_tool_start：创建新的 toolCall
if (event.type === 'agent_tool_start' && event.id) {
  // 找到对应消息，追加 toolCall，清除等待状态
}

// agent_tool_end：更新 toolCall 状态和结果
if (event.type === 'agent_tool_end' && event.id) {
  // 找到对应 toolCall，更新 status/result/endTime
}

// agent_delta：清除等待状态
if (event.type === 'agent_delta') {
  // 设置 isWaitingForFirstToken: false
}
```

修改 `sendMessage`：创建 assistant 消息时设置 `isWaitingForFirstToken: true`

### Step 3: 添加 CSS 动画

**文件**: `src/styles/globals.css`

```css
/* Typing dots 动画 */
.typing-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--primary);
  animation: typing-bounce 1.4s infinite ease-in-out both;
}
.typing-dot:nth-child(1) { animation-delay: -0.32s; }
.typing-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Tool call card 样式 */
.tool-call-card[data-status="running"] {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary-glow);
}

/* 折叠动画 */
.tool-call-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease-out;
}
.tool-call-content[data-expanded="true"] {
  grid-template-rows: 1fr;
}
```

### Step 4: 创建 WaitingIndicator 组件

**新文件**: `src/components/agent/WaitingIndicator.tsx`

三个圆点波浪动画 + "AI 正在思考" 文案

### Step 5: 创建 ToolCallBlock 组件

**新文件**: `src/components/agent/ToolCallBlock.tsx`

- `ToolCallsBlock`：可折叠容器，显示工具数量，pending 时数字闪烁
- `ToolCallCard`：单个工具卡片
  - 工具图标 + 名称 + 状态指示器（旋转/对勾/红叉）
  - 可展开显示参数和结果
  - running 状态带 primary 边框发光

**工具图标映射**（使用 emoji，简洁直观）：
```typescript
const TOOL_ICONS: Record<string, string> = {
  read_excel: '📄', write_excel: '📝', apply_formula: '🔢',
  bash: '💻', read: '📄', write: '📝', edit: '✏️',
  // ...
};
```

### Step 6: 集成到 MessageList

**文件**: `src/components/agent/MessageList.tsx`

在 assistant 消息渲染中：

```tsx
{message.role === 'assistant' && (
  <>
    {/* 等待动效 */}
    {message.isWaitingForFirstToken && !message.toolCalls?.length && (
      <WaitingIndicator />
    )}

    {/* 工具调用 */}
    {message.toolCalls && message.toolCalls.length > 0 && (
      <ToolCallsBlock toolCalls={message.toolCalls} />
    )}

    {/* 内容 */}
    <MarkdownRenderer ... />
  </>
)}
```

---

## Files Summary

| 文件 | 变更 |
|------|------|
| `src/types/agent.ts` | 扩展 ToolCall 添加 id/startTime/endTime；AgentMessage 添加 isWaitingForFirstToken |
| `src/stores/agentStore.ts` | 添加 agent_tool_start/end 事件处理；sendMessage 设置等待状态 |
| `src/styles/globals.css` | 添加 typing dots 动画、tool call card 样式、折叠动画 |
| `src/components/agent/MessageList.tsx` | 集成 WaitingIndicator 和 ToolCallsBlock |
| `src/components/agent/WaitingIndicator.tsx` | **新建**：等待动效组件 |
| `src/components/agent/ToolCallBlock.tsx` | **新建**：工具调用可折叠 UI 组件 |

---

## Verification

1. **等待动效**：
   - 发送消息后应立即显示三圆点动画 + "AI 正在思考"
   - 收到首个 delta 或 tool_start 后动效消失

2. **工具调用**：
   - 工具开始：显示卡片，状态为 running（旋转图标 + primary 边框）
   - 工具结束：状态变为 completed（绿色对勾）或 error（红色叉号）
   - 点击卡片可展开/折叠查看参数和结果

3. **动效原则**（DESIGN.md）：
   - 流式输出使用 `opacity-0 → opacity-100`，300ms ease-out
   - 折叠展开使用 grid-template-rows 平滑过渡
   - 遵守 `prefers-reduced-motion`

---

## 状态流程图

```
用户发送消息
    │
    ▼
创建 assistant 消息
(isStreaming: true, isWaitingForFirstToken: true, toolCalls: [])
    │
    ├─► agent_tool_start ──► 添加 toolCall, isWaitingForFirstToken: false
    │
    ├─► agent_tool_end ──► 更新 toolCall.status/result
    │
    ├─► agent_delta ──► 追加 content, isWaitingForFirstToken: false
    │
    └─► agent_done ──► isStreaming: false
```
