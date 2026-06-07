## Context

用户希望在右侧 `AgentChatPanel` 底部输入框上方增加固定快捷按钮：**公式生成**、**提示词生成**。点击按钮后**不进入** pi-agent 的 AgentSession / tool loop，而是像 `BatchRunner._callLLM`（`src-agent/src/batch/runner.ts:211-232`）那样直接通过 `@earendil-works/pi-ai` 的 `stream()` 发起一次 LLM 调用。提示词由**当前已加载的 Excel 上下文**（文件、sheet、列，必要时带 sample preview）和**提示词库中的模板**组成；模板按 `name` 精确匹配 `Excel公式生成` / `提示词生成`（见 `docs/prompts.json:1, 25`）。输出进入右栏聊天消息流，体验与手动输入并发送后的流式输出一致；用户随后在输入框继续输入仍走**原 Agent 路径**（不进入 direct LLM 的多轮上下文）。

**模型选择**：与现有 Agent、BatchRunner 完全一致 —— 读取 `bridge.getDefaultModel()`（`src-agent/src/bridge.ts:40-48`），它返回的是用户在 `AgentInput` 下拉中选中的 active model（commit a62e9be 引入）。**不要**直接读 `uiStore.selectedAgentModelName`，那只有 `name`，拿不到 `apiKey` / `baseUrl`。

**改动目标**：为高频任务提供一键入口；不破坏 Agent 多轮 / 工具调用 / 现有 UI。

---

## 关键设计决策（与原 plan 差异，已锁定）

| # | 原 plan 描述 | 决策 / 修正 |
|---|---|---|
| 1 | "公式生成" 按 name 精确匹配 | 用现有模板名 **`Excel公式生成`**（id `formula_generation_system`），不要新建 |
| 2 | "从 excelStore 读取" | **优先用 `agentStore.loadedContext`**（已通过 `excelStore.notifyContextChange` 同步），仅 sample preview 从 `excelStore.selections[i].previewData[sheet]` 补 |
| 3 | "明确列名到列字母/列索引" | `apply_formula` 中 `{}` 替换为**行号**（`src-tauri/src/services/excel_service.rs:260`），不是列字母 —— 文档明确"行号占位规则" |
| 4 | "stop_stream 应能停止 direct LLM" | `src-agent/src/main.ts:237-238` 当前 `case 'stop': break;` 是空操作 —— **本任务顺手修复**：Node 侧维护 `AbortController` 单例，`stop` 命令触发 `abort()` |
| 5 | "复用 last-message append 模式" | 不可行 —— direct LLM 与 agent 流会串流。**必须**按 `requestId` 路由（见 §2.4） |
| 6 | "isSending 单一布尔" | 拆为 `agentStreamingRequestId` / `directStreamingRequestId` 两个 `string \| null`（见 §2.3） |
| 7 | "前端内置 fallback 文案" | 直接复用 `docs/prompts.json` 中 `Excel公式生成` 和 `提示词生成` 的 `content` 作为 hardcode 默认值 |
| 8 | "DESIGN.md §5 协议事件" | 应为 `docs/PROTOCOL.md` **§4**（§5 是 HTTP Bridge） |
| 9 | "sample preview 限制 5-10 行" | `excelStore.loadPreview` 默认拉 10 行；prompt 中**只截前 5 行** |
| 10 | "未加载 Excel 时点击 → 提示" | 按钮 `disabled`，hover `title` 文案 + `uiStore.toast` 提示（双保险） |
| 11 | "未配置模型时" | 按钮 `disabled`（`appliedModelName == null`），hover 提示去下拉选模型 |
| 12 | "可继续多轮对话" | 后续输入**走原 Agent 路径**（不引入 direct LLM 多轮）；多轮上下文由 AgentSession 自己维护 |

---

## Recommended approach

### 1. 前端：在 AgentChatPanel 中新增独立 QuickActionBar 组件

**位置**：`AgentChatPanel.tsx` 中，作为 `<AgentInput>` **上方**的独立组件（**不**嵌入 `AgentInput` 内部，保持单一职责）：

```
AgentChatPanel
  ├─ header
  ├─ <MessageList />
  ├─ <QuickActionBar />   ← 新增
  └─ <AgentInput />
```

**修改/新增文件**：

- `src/components/agent/AgentChatPanel.tsx` —— 引入并放置 `<QuickActionBar />`
- `src/components/agent/QuickActionBar.tsx`（**新建**）
- `src/components/agent/agentQuickActions.ts`（**新建**，纯函数，不放 `src/utils/` —— 该目录不存在）
- `src/stores/agentStore.ts` —— 新增 action 与 `requestId` 路由
- `src/types/agent.ts` —— `AgentMessage` 加可选 `requestId` / `fullContent` 字段
- `src/services/tauri.ts` —— 新增 `sendDirectLlmMessage(...)` 封装
- `src-tauri/src/commands/sidecar.rs` —— 新增 `send_direct_llm_message` Tauri command
- `src-tauri/src/services/sidecar_manager.rs` —— 新增 `send_direct_llm_message` 方法
- `src-tauri/src/lib.rs` —— `invoke_handler!` 注册新命令
- `src-agent/src/protocol.ts` —— 新增 `DirectLlmMessageCommand` 与 `agent_delta/done/error` 携带 `requestId`
- `src-agent/src/main.ts` —— 路由 `direct_llm_message`；修复 `case 'stop': break;` 空操作
- `src-agent/src/direct-llm.ts`（**新建**）—— `runDirectLlmStream` + `AbortController` 单例
- `docs/PROTOCOL.md` —— §4 新增命令与事件说明
- `DESIGN.md` —— §5.5 协议表新增 `direct_llm_message`；§8.3 之后新增 §8.7 "快捷 LLM 触发"；§9 双模式表追加第三行

#### 1.1 QuickActionBar 组件规格

**Props**：无（直接订阅 store）。

**渲染**：

```tsx
// 伪代码
const { status, isDirectStreaming, sendDirectLlmMessage } = useAgentStore();
const { files, selections, loadedContext } = ... // excelStore
const appliedModelName = useAgentStore(s => s.appliedModelName);

const hasExcel = (loadedContext?.loadedFiles?.length ?? 0) > 0;
const canClick = hasExcel && !!appliedModelName && !isDirectStreaming && (status?.ready ?? false);

<button disabled={!canClick} title={
  !hasExcel ? "请先在左侧加载 Excel 文件" :
  !appliedModelName ? "请先在 Agent 输入框选择模型" :
  !status?.ready ? "Sidecar 未就绪" :
  isDirectStreaming ? "正在生成中..." : ""
} onClick={() => onQuickAction('formula_generation')}>
  <Sigma /> 公式生成
</button>
<button disabled={!canClick} ...>提示词生成</button>
```

**样式**：沿用 `DESIGN.md` §1（`bg-[var(--surface)]`、`border: var(--border)`、`rounded-md`、hover 只换背景色）。按钮间距 `gap-2`，容器放在 `<form>` 之外但视觉上紧贴上方，padding 与 AgentInput 同步（`p-3`）。

#### 1.2 消息显示策略

`AgentMessage` 新增（`src/types/agent.ts`）：

```ts
interface AgentMessage {
  // ... 现有字段
  requestId?: string;       // 关联 direct LLM 流
  fullContent?: string;     // 实际发送给 LLM 的完整 prompt（仅 user 可选）
  displayContent?: string;  // UI 显示用摘要；缺省回退到 content
}
```

UI 行为（`MessageList.tsx`）：

- user 消息：若 `displayContent` 存在则显示它，附带 `<展开>` 按钮查看 `fullContent` 或 `content`
- assistant 消息：无差别（直接 LLM 与 agent 流视觉一致）

#### 1.3 直接 fallback：硬编码默认模板

`agentQuickActions.ts` 内导出：

```ts
export const FALLBACK_TEMPLATES: Record<'formula_generation' | 'prompt_generation', string> = {
  formula_generation: `你是一名顶级的 Excel 数据分析专家 ...`, // = docs/prompts.json Excel公式生成 .content
  prompt_generation: `# 角色 (Role) ...`,                       // = docs/prompts.json 提示词生成 .content
};
```

> 这两段是 `docs/prompts.json` 中 `Excel公式生成`（id `formula_generation_system`）和 `提示词生成`（id `prompt_generation_system`）的 `content` 字段，**直接 copy** 即可，不要再写一遍。

---

### 2. 前端 Store：requestId 路由 + 并发安全

修改 `src/stores/agentStore.ts`。

#### 2.1 新增 state

```ts
interface AgentStore {
  // ... 现有
  agentStreamingRequestId: string | null;   // 替换 isSending 的语义
  directStreamingRequestId: string | null;  // 新增
  get isSending(): boolean;                 // 兼容旧调用 = 两个 id 任一非空
  get isDirectStreaming(): boolean;
  sendDirectLlmMessage: (action, userDisplay, fullPrompt, context) => Promise<void>;
}
```

> **不要**保留单一 `isSending: boolean`，会导致"agent 流中点快捷按钮被错误禁用"或"快捷按钮流中输入框仍可发"。

#### 2.2 重构 `handleEvent`（核心）

**当前实现**（`agentStore.ts:117-153`）按"最后一条 assistant streaming message"追加 delta —— **必须替换**为按 `event.id` 查找对应 `AgentMessage`，因为 direct LLM 与 agent 流会**同时**追加到不同 message。

```ts
handleEvent: (event) => {
  if (event.type === 'agent_error') {
    set({ error: event.message });
    // 找到对应 message，标记 isStreaming = false
    if (event.id) {
      set(s => ({
        messages: s.messages.map(m =>
          m.requestId === event.id ? { ...m, isStreaming: false } : m
        ),
        [resolveRequestKind(event.id) === 'agent' ? 'agentStreamingRequestId' : 'directStreamingRequestId']: null,
      }));
    }
    return;
  }
  if (event.type === 'agent_delta' && event.id && event.delta) {
    set(s => {
      const idx = s.messages.findIndex(m => m.requestId === event.id);
      if (idx === -1) {
        // 不存在则追加（兼容旧 agent 流没传 requestId 的场景）
        return { messages: [...s.messages, {
          id: `assistant-${event.id}`,
          requestId: event.id,
          role: 'assistant', content: event.delta, isStreaming: true,
        }]};
      }
      const arr = [...s.messages];
      arr[idx] = { ...arr[idx], content: arr[idx].content + event.delta };
      return { messages: arr };
    });
    return;
  }
  if (event.type === 'agent_done' && event.id) {
    set(s => ({
      messages: s.messages.map(m =>
        m.requestId === event.id ? { ...m, isStreaming: false } : m
      ),
      [resolveRequestKind(event.id) === 'agent' ? 'agentStreamingRequestId' : 'directStreamingRequestId']: null,
    }));
  }
};

// id 前缀: 'msg-' -> agent; 'direct-' -> direct LLM
function resolveRequestKind(id: string): 'agent' | 'direct' {
  return id.startsWith('direct-') ? 'direct' : 'agent';
}
```

> **重要**：现有 `handleUserMessage`（`src-agent/src/main.ts:57-111`）发出的 `agent_delta/done` 事件 `id` 是 `msg-<millis>`（`sidecar_manager.rs:96`）。为支持 requestId 路由，**Rust 端 `send_user_message`** 也要在 payload 里固定加 `"kind": "user_message"`，让 store 知道这是 agent 路径（或者直接看 `id` 前缀，更简单）。

#### 2.3 sendDirectLlmMessage action

```ts
sendDirectLlmMessage: async (action, userDisplay, fullPrompt, context) => {
  const { status, directStreamingRequestId } = get();
  if (directStreamingRequestId) throw new Error('direct LLM 正在生成中');
  if (!status?.ready) throw new Error('Sidecar 未就绪');

  const requestId = `direct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const userMsg: AgentMessage = {
    id: `user-${requestId}`,
    requestId,
    role: 'user',
    content: userDisplay,           // 简短摘要
    displayContent: userDisplay,
    fullContent: fullPrompt,        // 完整 prompt（用于展开查看）
  };
  const assistantMsg: AgentMessage = {
    id: `assistant-${requestId}`,
    requestId,
    role: 'assistant',
    content: '',
    isStreaming: true,
  };

  set(s => ({
    messages: [...s.messages, userMsg, assistantMsg],
    directStreamingRequestId: requestId,
    error: null,
  }));

  try {
    await sendDirectLlmMessageRust({
      requestId,
      action,
      content: fullPrompt,
      context,                       // { file: { name, sheets: [{sheet, columns}] }, samplePreview?: string }
    });
  } catch (error) {
    set(s => ({
      error: error instanceof Error ? error.message : String(error),
      messages: s.messages.map(m => m.requestId === requestId ? { ...m, isStreaming: false } : m),
      directStreamingRequestId: null,
    }));
  }
},
```

#### 2.4 `tauri.ts` 新增封装

```ts
// src/services/tauri.ts
export interface DirectLlmRequest {
  requestId: string;
  action: 'formula_generation' | 'prompt_generation';
  content: string;
  context: DirectLlmContext;
}
export interface DirectLlmContext {
  fileName: string;                     // 仅文件名，不含路径
  sheets: Array<{
    sheet: string;
    columns: string[];                  // 已选中列
  }>;
  samplePreview?: string;               // Markdown 表格，<= 5 行
}

export function sendDirectLlmMessage(req: DirectLlmRequest) {
  return invoke<void>('send_direct_llm_message', { req });
}
```

---

### 3. Rust SidecarManager：新增 direct LLM stdin 命令

#### 3.1 Tauri command（`src-tauri/src/commands/sidecar.rs`）

```rust
#[tauri::command]
pub async fn send_direct_llm_message(
    state: State<'_, AppState>,
    req: DirectLlmRequest,                 // 新 DTO，src-tauri/src/models/agent.rs 定义
) -> Result<(), AppError> {
    state.sidecar_manager.send_direct_llm_message(req).await
}
```

#### 3.2 DTO（`src-tauri/src/models/agent.rs` 新增）

```rust
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmRequest {
    pub request_id: String,
    pub action: String,                    // "formula_generation" | "prompt_generation"
    pub content: String,
    pub context: DirectLlmContext,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmContext {
    pub file_name: String,
    pub sheets: Vec<DirectLlmSheet>,
    pub sample_preview: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmSheet {
    pub sheet: String,
    pub columns: Vec<String>,
}
```

#### 3.3 SidecarManager 方法（`src-tauri/src/services/sidecar_manager.rs`）

新增方法，与 `send_user_message`（`sidecar_manager.rs:95-105`）**完全对称**：

```rust
pub async fn send_direct_llm_message(&self, req: DirectLlmRequest) -> AppResult<()> {
    let payload = json!({
        "id": req.request_id,                  // 直接用前端给的 id，便于透传
        "type": "direct_llm_message",
        "action": req.action,
        "content": req.content,
        "context": req.context,
    });
    *self.is_streaming.write().await = true;  // 复用同一状态
    self.write_json_line(payload).await
}
```

**注意**：`id` 字段已经能区分 agent / direct（`msg-` vs `direct-` 前缀），前端 store 按前缀路由。**不要**新增 `kind` 字段。

#### 3.4 `stop_stream` 不需改

Rust 端 `stop_stream`（`sidecar_manager.rs:120-130`）写 `stop` 命令到 stdin。Node 侧在 main.ts 中处理 `stop` 时**同时** abort agent 和 direct LLM 的 controller（见 §4.6）。

#### 3.5 lib.rs 注册

```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有
    commands::sidecar::send_direct_llm_message,   // 新增
])
```

---

### 4. Node Sidecar：直接 LLM 流 + 修复 stop 空操作

#### 4.1 protocol.ts 新增命令（`src-agent/src/protocol.ts`）

```ts
export type SidecarCommand =
  | { id: string; type: 'ping' }
  | { id: string; type: 'user_message'; content: string }
  | { id: string; type: 'direct_llm_message'; action: string; content: string; context: DirectLlmContext }
  | { id: string; type: 'steer'; context: AgentContext }
  | { id: string; type: 'batch_start'; params: BatchParams }
  | { id: string; type: 'batch_pause'; batchId: string }
  | { id: string; type: 'batch_resume'; batchId: string }
  | { id: string; type: 'batch_stop'; batchId: string }
  | { id: string; type: 'batch_status'; batchId: string }
  | { id: string; type: 'stop' };
```

`SidecarEvent` 已有 `id` 字段（`protocol.ts:13-22`），**无需新增**。

#### 4.2 新建 `src-agent/src/direct-llm.ts`

**核心函数**：

```ts
import { stream } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai';
import type { BridgeClient } from './bridge.js';
import type { DirectLlmContext } from './protocol.js';

interface DirectLlmEvent {
  type: 'agent_delta' | 'agent_done' | 'agent_error';
  id: string;
  delta?: string;
  message?: string;
}

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  'openai-completions': 'OPENAI_API_KEY',
  'openai-responses': 'OPENAI_API_KEY',
  'anthropic-messages': 'ANTHROPIC_API_KEY',
};

function applyApiKeyEnv(providerType: string, apiKey: string | undefined): void {
  if (!apiKey) return;
  const envKey = PROVIDER_API_KEY_ENV[providerType];
  if (envKey && !process.env[envKey]) process.env[envKey] = apiKey;
}

// 整个进程单例；startDirectLlm 替换它；stop/abort 触发它的 abort
let currentAbort: AbortController | null = null;

export function abortDirectLlm(): void {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
}

export function isDirectLlmStreaming(): boolean {
  return currentAbort !== null;
}

export async function runDirectLlmStream(
  bridge: BridgeClient,
  command: Extract<SidecarCommand, { type: 'direct_llm_message' }>,
  emit: (event: DirectLlmEvent) => void,
): Promise<void> {
  if (currentAbort) {
    emit({ type: 'agent_error', id: command.id, message: '已有 direct LLM 在进行中' });
    return;
  }

  let modelInfo;
  try {
    modelInfo = await bridge.getDefaultModel();
  } catch (e) {
    emit({ type: 'agent_error', id: command.id, message: `获取模型失败: ${(e as Error).message}` });
    return;
  }

  let model: any;
  try {
    model = getModel(modelInfo.providerType as any, modelInfo.modelId as any);
    if (model && modelInfo.baseUrl) model = { ...model, baseUrl: modelInfo.baseUrl };
    applyApiKeyEnv(modelInfo.providerType, modelInfo.apiKey);
  } catch {
    emit({ type: 'agent_error', id: command.id, message: '模型解析失败，请到配置页检查' });
    return;
  }

  const controller = new AbortController();
  currentAbort = controller;

  const systemPrompt = buildDirectSystemPrompt(command.action, command.context);
  const finalPrompt  = `${command.content}\n\n---\n# Excel 上下文\n${formatContext(command.context)}`;

  try {
    const eventStream = stream(model, {
      systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: finalPrompt }], timestamp: Date.now() }],
    }, { temperature: 0.3, signal: controller.signal });

    for await (const ev of eventStream) {
      if (controller.signal.aborted) break;
      if (ev.type === 'text_delta' || (ev as any).type === 'text') {
        const delta = (ev as any).delta ?? (ev as any).text ?? '';
        if (delta) emit({ type: 'agent_delta', id: command.id, delta });
      }
    }
    emit({ type: 'agent_done', id: command.id });
  } catch (err) {
    if (controller.signal.aborted) {
      emit({ type: 'agent_done', id: command.id });   // 用户主动中止，按 done 处理
    } else {
      emit({ type: 'agent_error', id: command.id, message: (err as Error).message });
    }
  } finally {
    if (currentAbort === controller) currentAbort = null;
  }
}
```

**与 `BatchRunner._callLLM` 的差异**（`runner.ts:211-232`）：

- BatchRunner `for await` 里读 `event.type === 'done'`，累积 `text` 字段；direct LLM 直接转发 delta，**更实时**
- BatchRunner 没有 abort 透传；direct LLM 用 `signal: controller.signal` 并在 main.ts 路由 stop 时调用 `abortDirectLlm()`

#### 4.3 系统 prompt 与上下文格式

`buildDirectSystemPrompt` 与 `formatContext` 见 `agentQuickActions.ts`（前端） —— **Node 端不应再拼 prompt**，前端 `sendDirectLlmMessage` 时 `content` 已是完整 prompt，**Node 端只**调用 `stream()`。

> 把 prompt 拼接放前端的好处：与右键按钮 UI 状态绑定（displayContent 即为 prompt 摘要），调试方便；Rust/Node 只做传输。**禁止**在 Node 端再读 excelStore / promptStore。

#### 4.4 main.ts 路由

```ts
async function handleDirectLlmMessage(command: Extract<SidecarCommand, { type: 'direct_llm_message' }>) {
  if (!bridge) {
    emit({ type: 'agent_error', id: command.id, message: 'Bridge 未初始化' });
    return;
  }
  await runDirectLlmStream(bridge, command, emit);
}

async function handleCommand(command: SidecarCommand) {
  switch (command.type) {
    // ... 现有 case
    case 'direct_llm_message':
      await handleDirectLlmMessage(command);
      break;
    case 'stop':
      abortDirectLlm();              // 修复：之前是 break 空操作
      // AgentSession 的 prompt 仍由 session 自己的订阅处理；这里只管 direct
      break;
  }
}
```

#### 4.5 保留 AgentSession 的 stop 行为

`handleUserMessage`（`main.ts:57-111`）中 `session.prompt` 是长任务，无法从外部中断 —— 这是**现有缺陷**，本任务**不强制修复**。但文档要记录：direct LLM 的 stop 可用，agent 流 stop 当前仍无效。

#### 4.6 显式声明未做的事

- 不发送 `agent_tool_start/end`（direct LLM 路径明确不走工具）
- 不复用 `session.subscribe`，不进入 AgentSession
- 不调用 `applyApiKeyEnv` 之外的环境副作用

---

### 5. 提示词与 Excel 上下文构建（前端）

`src/components/agent/agentQuickActions.ts` 导出三个纯函数。

#### 5.1 `findPromptTemplate`

```ts
export const TEMPLATE_NAMES = {
  formula_generation: 'Excel公式生成',           // 对应 docs/prompts.json
  prompt_generation: '提示词生成',
} as const;

export function findPromptTemplate(
  prompts: Prompt[],
  action: keyof typeof TEMPLATE_NAMES,
): { template: string; usedFallback: boolean } {
  const target = TEMPLATE_NAMES[action];
  const hit = prompts.find(p => p.name === target);
  if (hit) return { template: hit.content, usedFallback: false };
  return { template: FALLBACK_TEMPLATES[action], usedFallback: true };
}
```

精确匹配 `name`，**不**做 trim / case-insensitive —— 模板库是用户可编辑的，模糊匹配会引入歧义。

#### 5.2 `buildExcelContext`

```ts
export interface BuiltContext {
  context: DirectLlmContext;
  displaySummary: string;       // 用于 user message 摘要
  sampleMissing: boolean;
}

export function buildExcelContext(
  loadedContext: AgentContext | null,
  selections: FileSelection[],
  previewData: PreviewData | null,
): BuiltContext | null {
  if (!loadedContext?.loadedFiles?.length) return null;

  const first = loadedContext.loadedFiles[0];
  const sel = selections.find(s => s.file.name === first.name);
  const activeSheet = first.sheets[0]?.sheetName;
  if (!activeSheet) return null;

  // 截取 sample preview 最多 5 行
  let samplePreview: string | undefined;
  let sampleMissing = false;
  const preview = sel?.previewData?.[activeSheet] ?? previewData;
  if (preview && preview.rows.length > 0) {
    const head = preview.rows.slice(0, 5);
    const cols = preview.columns;
    const header = '| ' + cols.join(' | ') + ' |';
    const sep    = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const body   = head.map(r => '| ' + cols.map(c => String(r[c] ?? '')).join(' | ') + ' |').join('\n');
    samplePreview = `${header}\n${sep}\n${body}`;
  } else {
    sampleMissing = true;
  }

  // 隐私：只发文件名，不发绝对路径
  const ctx: DirectLlmContext = {
    fileName: first.name,
    sheets: first.sheets.map(s => ({ sheet: s.sheetName, columns: s.columns })),
    samplePreview,
  };

  const displaySummary = `使用「${TEMPLATE_NAMES[...]}」模板 · 文件：${first.name} · Sheet：${activeSheet} · 列：${first.sheets[0]?.columns.join(', ') ?? '(无)'}${sampleMissing ? ' · 未加载样例预览' : ''}`;

  return { context: ctx, displaySummary, sampleMissing };
}
```

**重要决策**：

- `loadedContext` 优先，**不**直接 `excelStore.files/selections` 现取 —— `loadedContext` 已经是过滤后的"已选中 sheets/columns"（`excelStore.ts:181-213`）
- **不**自动 `loadPreview`：避免对大 Excel 的意外 Tauri 调用。`sampleMissing = true` 时仍发送请求，让模型基于列名推断
- **只**发 `file.name`：`LoadedFile.path` 是绝对路径，含用户名

#### 5.3 `buildDirectPrompt`

```ts
export function buildDirectPrompt(
  action: keyof typeof TEMPLATE_NAMES,
  template: string,
  ctx: DirectLlmContext,
): string {
  const header =
    action === 'formula_generation'
      ? `# 任务：生成 Excel 公式\n\n请基于下方 Excel 上下文，仅输出可粘贴到目标单元格的 Excel 公式；` +
        `行号占位符 \`{}\` 会被替换为实际行号（如 \`=A{}+B{}\` 展开为 \`=A2+B2\`）。`
      : `# 任务：生成提示词模板\n\n请基于下方 Excel 上下文，生成适合批量处理当前行数据的提示词模板，输出列、格式与约束需明确。`;

  return `${template}\n\n${header}`;
}
```

> **注意**：原 plan 提到"列名到列字母/列索引"，但 `apply_formula` 实际替换为**行号**（`excel_service.rs:260`）。prompt 中明确说"行号占位符 `{}`"。

---

### 6. 协议与设计文档更新

#### 6.1 `docs/PROTOCOL.md` §4

- §4.1 `SidecarCommand` 增加 `direct_llm_message` 变体
- §4.2 表格注脚：声明 `agent_delta / agent_done / agent_error` 的 `id` 字段可携带 `direct-` 前缀，用于区分 Agent 流与 Direct LLM 流
- §6.1 之后新增 §6.6 "Direct LLM 生命周期" 描述流
- 原 §5 / §8 / §10 引用若提到"快捷按钮"或"direct LLM"，同步更新

#### 6.2 `DESIGN.md`

- §5.5 协议表新增一行：`direct_llm_message` (stdin) / `agent_delta + id=direct-...` (stdout)
- §8 新增 §8.7 "快捷 LLM 触发"（与 §8.3 批量处理双触发对称的 ASCII 图）
- §9 双模式表追加第三行：右栏快捷 LLM（固定模板 + Excel 上下文的一次性流式生成）

---

## Critical implementation order

每步完成后做对应验证再进入下一步。

1. **读源码 + 校对 plan**：阅读 `AgentInput.tsx:27-242`、`agentStore.ts:30-168`、`sidecar_manager.rs:95-148`、`main.ts:57-240`、`agent.ts:21-65`、`runner.ts:211-232`、`bridge.ts:40-52`、`apply_formula`（`excel_service.rs:213-274`）。**验证**：与本 plan §1-5 描述一致。
2. **新建 `src-agent/src/direct-llm.ts`**：`runDirectLlmStream` + `AbortController` 单例 + `abortDirectLlm` + `isDirectLlmStreaming`。**验证**：`npm --prefix src-agent run build` 通过；写一个临时 stdin `{"type":"direct_llm_message","id":"direct-test","action":"formula_generation","content":"hi","context":{...}}` 跑 `npm --prefix src-agent run dev`，观察 stdout 是否有 `agent_delta/done`。
3. **修改 `src-agent/src/main.ts`**：路由 `direct_llm_message`；**修复** `case 'stop': break;` 为 `abortDirectLlm()`。**验证**：跑两次 `direct_llm_message`，第一次发 `stop`，应看到 `agent_done`。
4. **修改 `src-agent/src/protocol.ts`**：增加 `direct_llm_message` 命令类型 + `DirectLlmContext` 接口。**验证**：`npm --prefix src-agent run build`。
5. **修改 Rust 端**：新增 `DirectLlmRequest` DTO、`send_direct_llm_message` Tauri command、`SidecarManager::send_direct_llm_message`、lib.rs 注册。**验证**：`cargo check` 通过。
6. **修改前端 tauri.ts**：新增 `sendDirectLlmMessage` 封装。**验证**：`npm run typecheck`。
7. **修改 `src/stores/agentStore.ts`**：拆分 `agentStreamingRequestId` / `directStreamingRequestId`；`handleEvent` 按 `requestId` 路由；新增 `sendDirectLlmMessage` action。**验证**：`npm run typecheck`。
8. **修改 `src/types/agent.ts`**：`AgentMessage` 加 `requestId?` / `displayContent?` / `fullContent?`。**验证**：`npm run typecheck`。
9. **新建 `src/components/agent/agentQuickActions.ts`**：导出 `TEMPLATE_NAMES` / `FALLBACK_TEMPLATES` / `findPromptTemplate` / `buildExcelContext` / `buildDirectPrompt` / `resolveRequestKind`。**验证**：`npm run typecheck`。
10. **新建 `src/components/agent/QuickActionBar.tsx`**：两个按钮 + disabled 条件 + tooltip。**验证**：`npm run build`。
11. **修改 `AgentChatPanel.tsx`**：在 `<AgentInput>` 上方插入 `<QuickActionBar />`。**验证**：`npm run build` + 启动 `npm run tauri dev`，肉眼确认按钮显示与 disabled 文案。
12. **修改 `MessageList.tsx`**：当 `displayContent` 存在时用它渲染 user 消息，附展开按钮。**验证**：`npm run typecheck`。
13. **更新 `docs/PROTOCOL.md` §4 与 §6.6**。**验证**：grep `direct_llm_message` 应出现在 §4.1。
14. **更新 `DESIGN.md` §5.5 / §8.7 / §9**。**验证**：grep `direct_llm_message` / "Direct LLM" 应出现 3 处。
15. **端到端冒烟**（见 Verification §B）。

---

## Verification

### A. 静态 / 构建检查

| 层 | 命令 | 通过条件 |
|---|---|---|
| 前端 typecheck | `npm run typecheck` | 0 errors |
| 前端 build | `npm run build` | bundle 生成 |
| Sidecar build | `npm --prefix src-agent run build` | 0 errors |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | 0 errors / 0 warnings |
| 启动 | `npm run tauri dev` | 应用启动、Sidecar 5s 内 ready |

### B. 端到端冒烟

| 场景 | 期望 |
|---|---|
| B1. 启动后右栏无 Excel | 「公式生成」「提示词生成」**disabled**，hover 显示"请先在左侧加载 Excel 文件" |
| B2. 加载 Excel 但**未在下拉选模型** | 按钮 disabled，hover "请先在 Agent 输入框选择模型" |
| B3. 选好模型 + Excel，**preview 未加载** | 按钮可点；点击后 user 消息摘要含"未加载样例预览"；流式输出正常 |
| B4. 加载 preview 10 行 | prompt 中 sample preview **仅含前 5 行**的 Markdown 表格 |
| B5. 提示词库无 `Excel公式生成` | 用 FALLBACK_TEMPLATES 兜底；user 消息**额外**显示 `[已使用默认模板]` 前缀（`usedFallback = true`） |
| B6. 公式生成流式过程中点另一个按钮 | 第二个按钮 disabled（`directStreamingRequestId` 非空） |
| B7. 流式过程中按 Esc 或**点停止按钮**（复用 AgentInput 的 Square） | `stop` 写 stdin → Node `abortDirectLlm()` → emit `agent_done` → 前端 message 收尾不再追加 |
| B8. 流式完成后输入框发普通消息 | 走原 Agent 路径（`agentStreamingRequestId` 变更，不影响 direct） |
| B9. **并发**：direct LLM 流中 + 手动输入消息 | 两条 message **互不串流**（`requestId` 路由正确） |
| B10. 切换模型（下拉）后再点快捷按钮 | 用**新**模型（验证 active model 跟随） |
| B11. `LoadedFile.path` 不出现在 wire payload | grep `request.content` 与 `request.context` 不含绝对路径 |
| B12. `apply_excel_formula` 涉及的 `{}` 行号占位 | 模型输出 prompt 摘要中明示规则 |
| B13. `case 'stop'` 真能 abort | Node stdout 在 `abort` 后**仅** emit 一次 `agent_done`，无 `delta` 跟在后面 |
| B14. 旧功能不回归 | LLM 批量处理 / Python 处理 / Agent 多轮 / steer 全部正常 |

### C. 回归基线命令

```bash
# 前端
npm run typecheck
npm run build

# Sidecar
npm --prefix src-agent run build

# Rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml   # 现有 28 个测试不应失败
```

---

## Notes / constraints

- **不要**把快捷按钮实现为向 AgentSession 发"请生成公式"的普通消息 —— 用户明确要 direct LLM
- **不要**在 Node 端再读 promptStore / excelStore / file path —— prompt 与 context 全部由前端构造好
- **不要**新增独立前端 i18n 库 —— 复用现有中文文案（`displayContent` 末尾的"未加载样例预览"等）
- **不要**自动 `loadPreview` —— 避免大 Excel 的意外 IO；preview 缺失时由模型基于列名推断
- **不要**把 `LoadedFile.path` 发到 LLM —— 只发 `file.name`
- **必须**修复 `case 'stop': break;` 空操作（§4.4） —— 不修就没法停止 direct LLM
- **必须**按 `requestId` 路由 delta —— 不改就与 agent 流串流
- **必须**让 `direct_llm_message` 的 Node 处理**不进入** `session.prompt` —— 走 `stream()` 独立调用
- **必须**保持 `id` 字段透传 —— 前端 Rust / Node 不修改 `id`，由 store 按前缀路由
- **API Key 仍走 `applyApiKeyEnv`**（`src-agent/src/agent.ts:7-19`）—— 与 Agent、BatchRunner 一致
- `session.prompt` 的 abort 仍**未实现**（既有问题），本任务**不强制**修，但 §4.5 要在交付说明中标注
