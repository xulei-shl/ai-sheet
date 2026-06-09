# LLM 批处理重构计划 — 前端直接调用 OpenAI API

## Context

当前 LLM 批处理存在两个核心问题：
1. **经过 Agent 调用**：`processingStore.startBatch()` 通过 `invoke('send_agent_message')` 发 JSON 到 Sidecar，走 Agent 路径，输出显示在 AgentChatPanel 而非 LLM 处理页面
2. **整表读取**：BatchRunner 通过 bridge 一次拉取所有列数据

**目标**：简化逻辑，前端直接用 OpenAI API 调用 LLM，一行数据一次调用，成功写回输出列，失败写回 `AI错误` 列。支持批次大小（并发数）、模型选择、运行日志直接输出在终端日志。

---

## 实现步骤

### Step 1: 新建 `src/services/openaiClient.ts`

极简 OpenAI Completions API 封装，只做一件事：调用 `/v1/chat/completions`

```typescript
interface OpenAIChatParams {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  signal?: AbortSignal;
}

export async function callOpenAIChat(params: OpenAIChatParams): Promise<string>
```

- URL: `{baseUrl}/v1/chat/completions`（baseUrl 末尾去 `/`）
- 超时: `AbortSignal.timeout(120_000)` 合并用户 signal
- 错误: 抛出含 HTTP status 和 response body 的 Error
- 返回: `data.choices[0].message.content.trim()`

### Step 2: 新建 `src/services/llmBatchService.ts`

批处理编排核心，负责：读取数据 → 逐行调用 LLM → 写回结果 → 日志回调

```typescript
export interface LLMBatchParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  errorColumn: string;       // 默认 'AI错误'
  prompt: string;
  model: { baseUrl: string; apiKey: string; modelId: string };
  batchSize: number;         // 并发数，默认 3
  temperature: number;
  onLog: (log: BatchLog) => void;
  onProgress: (current: number, total: number, speed: number) => void;
  onRowComplete: (row: number, result: string) => void;
  onRowError: (row: number, error: string) => void;
  signal: AbortSignal;
}

export async function runLLMBatch(params: LLMBatchParams): Promise<void>
```

**流程**：
1. 调用 Tauri `get_column_data(path, sheet, inputColumns)` 读取数据
2. 信号量控制并发（`batchSize` 个同时请求）
3. 每行：
   - 构建 prompt：`{列名}` 替换为行值；若无占位符则用 `|||` 拼接追加
   - 调用 `callOpenAIChat()`
   - 成功 → `write_excel_results` 写到输出列
   - 失败 → `write_excel_results` 写到错误列，该行不阻塞
   - 触发 `onRowComplete` / `onRowError` 回调
4. 429 限流：自动退避重试 1 次（delay 2s）
5. 中止：`signal.aborted` 时停止发新请求，进行中的自然中止

**信号量**：简单计数器 + 队列实现，约 20 行代码。

**暂停/继续**：在信号量 acquire 中检查 `paused` 标志，暂停时等待 Promise。

### Step 3: 修改 Rust `write_excel_results` — 支持自动创建新列

当前 `ExcelService::write_results` 找不到列名时直接报错。需要改为：
- 若列名不存在，自动追加到 header 末尾（与 `apply_formula` 的 `strategy: "append"` 行为一致）
- 列数据行数不足时自动补空字符串

**修改文件**：
- `src-tauri/src/services/excel_service.rs`：`write_results` 方法中，若 `headers.iter().position()` 返回 None，执行 `headers.push(req.column)` 并调整 data_rows 中每行补空
- 无需修改 `models/excel.rs` 和 `commands/excel.rs`

### Step 4: 修改 `src/stores/processingStore.ts`

**移除**：
- `invoke('send_agent_message')` 调用
- Tauri Events 监听（`batch-progress` / `batch-row-complete` / `batch-done` / `batch-error`）
- `subscribeToEvents()` 方法

**新增状态**：
- `selectedModel: ModelConfig | null` — 选中的大模型
- `batchSize: number` — 并发数，默认 3
- `errorColumn: string` — 错误列名，默认 `AI错误`
- `abortController: AbortController | null`
- `paused: boolean`

**改造 `startBatch()`**：
1. 创建 `AbortController`
2. 调用 `runLLMBatch({ ... })` 传入所有参数和回调
3. 回调中更新 `batchProgress` / `batchLogs`

**改造 `pauseBatch()` / `resumeBatch()`**：设置/清除 `paused` 标志

**改造 `stopBatch()`**：调用 `abortController.abort()`

### Step 5: 修改 `src/pages/LLMProcessingPage.tsx` — UI 更新

**中间配置面板新增**：

1. **大模型选择下拉框**：
   - 数据源：`configStore.userModels`
   - 过滤条件：`providerType === 'openai-completions'`（仅 OpenAI Completions 协议模型）
   - 显示模型 `name`，选中后存入 `processingStore.selectedModel`

2. **批次大小输入**：数字输入框，默认 3，min=1，max=10

3. **错误列名输入**：默认 `AI错误`，可自定义

**输出列选项调整**：
- 移除 `{ value: '__new__', label: '[新建列] AI结果' }` 选项
- 改为在输出列下拉框中新增 `[新建列]` 选项，选中后弹出输入框让用户输入新列名
- 或者更简单：直接允许用户在下拉框外手动输入新列名（text input + select 混合模式）
- **最终方案**：保留下拉选择已有列 + 末尾增加 `[新建列]` 选项，选中后显示文本输入框

### Step 6: 更新 `src/types/processing.ts`

新增/调整类型以适配新流程。

---

## 关键文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| **新建** | `src/services/openaiClient.ts` | OpenAI API 调用封装（~40行） |
| **新建** | `src/services/llmBatchService.ts` | 批处理编排逻辑（~150行） |
| **修改** | `src-tauri/src/services/excel_service.rs` | `write_results` 支持自动创建新列 |
| **修改** | `src/stores/processingStore.ts` | 移除 Sidecar 调用，改前端直接执行 |
| **修改** | `src/pages/LLMProcessingPage.tsx` | 新增模型选择、批次大小、错误列、新建列 |
| **修改** | `src/types/processing.ts` | 类型调整 |

**不改动**：
- `src-tauri/src/commands/excel.rs` — IPC 命令层无需改动
- `src-tauri/src/models/excel.rs` — DTO 无需改动
- `src-agent/` — Sidecar 不再参与批处理
- `src/components/agent/MessageList.tsx` — 批处理不再走 Agent 消息

---

## 验证方式

1. 在配置页面添加一个 OpenAI-compatible 模型（providerType 选 `openai-completions`）
2. 数据页面导入 Excel 文件（含若干文本列）
3. 切换到 LLM 批量处理页面
4. 选择文件/Sheet → 选择输入列 → 选择/新建输出列 → 选择模型 → 设置批次大小=3
5. 输入提示词模板（如 `请翻译以下文本：{原文}`）
6. 点击"开始"
7. **验证点**：
   - 终端日志逐行显示每行处理结果
   - 进度条实时更新
   - 打开 Excel 文件确认输出列写入正确
   - 模拟错误场景：API key 错误 → `AI错误` 列写入错误信息
   - 暂停 → 继续功能正常
   - 停止 → 已写入的数据保留
   - 新建列自动创建成功
