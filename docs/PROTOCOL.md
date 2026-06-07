# 通信协议参考（PROTOCOL）

> 跨进程通信的所有具体协议。本文是协议字段的**唯一真实来源**。
> 配套：`DESIGN.md` §5（架构概览）、`HANDOFF.md`（实装与缺口）。
>
> 范围：
> 1. Tauri IPC（React ↔ Rust）
> 2. Sidecar stdin/stdout JSONL（Rust ↔ Node.js）
> 3. HTTP Bridge（Node.js ↔ Rust 业务服务）
> 4. Tauri Events（Rust → React 广播）

---

## 1. 启动顺序

```
Tauri Builder
   │
   ▼
.setup()
   │
   ├─► 初始化 SQLite（app_data_dir/ai-sheet.db）
   │
   ├─► 启动 HTTP Bridge（动态端口 127.0.0.1:0）
   │      └─► 拿到 port N
   │
   └─► SidecarManager.set_bridge_port(N)
         └─► spawn node src-agent/dist/main.js --bridge-port N
               │
               ▼
         Node.js 解析 --bridge-port，构造 BridgeClient(N)
               │
               ▼
         emit({type:'sidecar_ready'})   ← stdout 第一行
```

---

## 2. Tauri IPC（React → Rust）

封装层：`src/services/tauri.ts::invoke(...)`。

### 2.1 Excel 命令

| 命令 | 入参 | 出参 | 错误 |
|---|---|---|---|
| `get_excel_info` | `{ path: string }` | `ExcelInfo` | AppError |
| `get_sheet_names` | `{ path: string }` | `string[]` | AppError |
| `get_column_names` | `{ path, sheet }` | `ColumnInfo[]` | AppError |
| `get_sample_data` | `{ path, sheet, rows? }` | `SampleData` | AppError |
| `get_column_data` | `{ path, sheet, columns: string[] }` | `ColumnData` | AppError |
| `get_excel_processing_status` | `{ path, sheet, resultColumn }` | `ProcessingStatus` | AppError |
| `write_excel_results` | `{ req: WriteResultsRequest }` | `void` | AppError |
| `apply_excel_formula` | `{ req: ApplyFormulaRequest }` | `void` | AppError |

### 2.2 Config 命令

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_active_model` | — | `ModelConfig` |
| `get_fallback_models` | — | `ModelConfig[]` |
| `get_user_models` | — | `ModelConfig[]` |
| `add_user_model` | `{ model: ModelConfig }` | `ModelConfig` |
| `update_user_model` | `{ index, model }` | `void` |
| `delete_user_model` | `{ index }` | `void` |

> `ModelConfig.apiKey` 入库时**强制为空字符串**，实际值存到
> `plugin-store` 中 `api_key:<name>` 键下。`configStore.fetchModels()`
> 负责把密文读回填到内存中的 `apiKey`。

### 2.3 Prompt 命令

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_all_prompts` | — | `Prompt[]` |
| `save_prompt` | `{ input: PromptInput }` | `Prompt` |
| `update_prompt` | `{ id, input }` | `void` |
| `delete_prompt` | `{ id }` | `void` |

### 2.4 Formula Cache 命令

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_formula_history` | — | `FormulaCacheEntry[]` |
| `save_formula_cache` | `{ requirement, columnsKey, formula, explanation? }` | `number` (新 id) |
| `touch_formula_cache` | `{ id }` | `void` |

### 2.5 Sidecar 命令

| 命令 | 入参 | 出参 | 备注 |
|---|---|---|---|
| `get_agent_status` | — | `AgentStatus` | 心跳 / streaming / 离线 |
| `send_agent_message` | `{ content: string }` | `void` | 写 stdin user_message |
| `steer_agent` | `{ context: string }` | `void` | content 为 JSON 字符串 |
| `stop_agent_stream` | — | `void` | 写 stdin stop |
| `restart_sidecar` | — | `void` | 杀进程 + 重启 |

### 2.6 System

| 命令 | 出参 |
|---|---|
| `get_app_status` | `{ name, version }` |

---

## 3. Tauri Events（Rust → React）

封装层：`src/services/tauri.ts::onXxx(...)`。

| 事件名 | Payload | 触发时机 |
|---|---|---|
| `bridge-ready` | `{ port: number }` | HTTP Bridge 启动完成 |
| `sidecar-ready` | `{}` | Sidecar 启动完成（**注：当前实现是 `sidecar_ready` 经 stdout 转发为 `agent-event`，并未单独 emit `sidecar-ready` 事件——前端通过 `agent-event` 监听 `type=='sidecar_ready'`**） |
| `sidecar-heartbeat` | `{ type:'heartbeat', timestamp }` | 每 5s |
| `sidecar-dead` | `{ message: string, elapsedSecs?: number }` | 心跳超时 / stdout 关闭 |
| `sidecar-restarted` | `{ message: string }` | restart() 成功 |
| `agent-event` | `SidecarEvent`（见 §4.2） | 透传 Sidecar stdout 所有业务事件 |
| `batch-progress` | `BatchProgress` | 批量进度 |
| `batch-row-complete` | `{ batchId, row, result }` | 单行完成 |
| `batch-done` | `BatchStats` | 批量完成 |
| `batch-error` | `{ batchId, message }` | 批量错误 |
| `batch-paused` | `{ batchId }` | 暂停 |
| `bridge-notification` | 任意 | 透传 Sidecar `/api/events/notify` |

> ⚠ **历史包袱**：早期设计 `sidecar-ready` 作为独立事件，但实装中 Sidecar
> 用 stdout `sidecar_ready` 事件做就绪信号，Rust 透传到 `agent-event` 通道。
> 前端 `AgentStore` 监听 `agent-event` 并在 `type=='sidecar_ready'` 时认为
> Agent 就绪。详见 `HANDOFF.md` §6.1。

---

## 4. Sidecar JSONL（Rust ↔ Node.js）

文件：`src-agent/src/protocol.ts`（TypeScript 类型）+ `SidecarManager`
（Rust 写入/解析）。

**格式**：每行一个完整 JSON，以 `\n` 结尾（`\n` 是消息边界）。
**方向**：
- **stdin** (Rust → Node): 命令
- **stdout** (Node → Rust): 事件（Rust 透传到 `agent-event`）

### 4.1 SidecarCommand（stdin）

```ts
type SidecarCommand =
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

`id` 由 Rust/前端生成：Agent 流用 `msg-<millis>`，Direct LLM 流用 `direct-<millis>-<rand>`，
steer 用 `steer-<millis>`，batch 用 `batch-<millis>`。
Node.js 在对应事件中带回（便于关联）。

> **注意**：`id` 前缀用于前端 store 路由 —— `msg-` 前缀的 `agent_delta/done/error`
> 路由到 Agent 流状态（`agentStreamingRequestId`），`direct-` 前缀路由到 Direct LLM
> 流状态（`directStreamingRequestId`）。两者互不阻塞，可并发。

#### DirectLlmContext

```ts
interface DirectLlmContext {
  fileName: string;
  sheets: Array<{ sheet: string; columns: string[] }>;
  samplePreview?: string;  // Markdown 表格，<= 5 行
}
```

#### AgentContext

```ts
interface AgentContext {
  currentTab: string;          // e.g. "data", "formula", "ai"
  loadedFiles: string[];       // 文件绝对路径
  selectedColumns: string[];   // 所有选中列
  sampleDataPreview?: string;  // Markdown 表格预览，最多 20 行
}
```

#### BatchParams

```ts
interface BatchParams {
  filePath: string;
  sheet: string;
  inputColumns: string[];
  outputColumn: string;
  prompt: string;              // 支持 {列名} 占位符 + {combined}
  modelId?: string;            // 留空走 default model
  providerType?: string;       // pi-ai provider type
  temperature?: number;
  savePrompt?: boolean;        // Agent 触发时可保存
  promptName?: string;
}
```

### 4.2 SidecarEvent（stdout）

```ts
type SidecarEvent =
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'agent_delta'; id: string; delta: string }
  | { type: 'agent_done'; id: string }
  | { type: 'agent_error'; id?: string; message: string }
  | { type: 'agent_tool_start'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'agent_tool_end'; id: string; tool: string; result: string }
  | { type: 'batch_progress'; batchId: string; current: number; total: number; speed: number }
  | { type: 'batch_row_complete'; batchId: string; row: number; result: string }
  | { type: 'batch_done'; batchId: string; stats: BatchStats }
  | { type: 'batch_error'; batchId: string; message: string }
  | { type: 'batch_paused'; batchId: string }
  | { type: 'sidecar_ready' };
```

#### BatchStats

```ts
interface BatchStats {
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  totalTimeMs: number;
  avgSpeed: number;        // 行/秒
}
```

### 4.3 错误格式

任何错误通过 `agent_error` 事件：

```json
{ "type": "agent_error", "id": "msg-1717692000000", "message": "..." }
```

未捕获异常与 unhandledRejection 也会生成 `agent_error`。

### 4.4 写入约束

- `SidecarManager::write_json_line` 内部用 `tokio::time::timeout(SEND_TIMEOUT, write_all + flush)` 包裹。
- 单行最大：`serde_json::to_vec` 后必须以 `\n` 结尾。
- `SEND_TIMEOUT = 3s`（常量在 `sidecar_manager.rs`）。

---

## 5. HTTP Bridge（Node.js → Rust）

文件：`src-tauri/src/services/bridge_server.rs`（Rust 路由）+ `src-agent/src/bridge.ts`（客户端）。

### 5.1 连接

- 监听：`127.0.0.1:0`（OS 分配端口）。
- 端口发现：启动时 Rust 获得端口 → 注入 `SidecarManager` → 通过
  `--bridge-port N` 启动参数传给 Node.js。
- 客户端：Node.js `new BridgeClient(N)`，基址 `http://127.0.0.1:N`。

### 5.2 请求格式

标准 HTTP/1.1，POST 居多，部分 GET。

```
POST /api/excel/info HTTP/1.1
Content-Type: application/json
Content-Length: 42

{"path":"C:/data/sales.xlsx"}
```

### 5.3 响应格式

**成功**（HTTP 200）：

```json
{ ...payload }
```

**错误**（仍 HTTP 200）：

```json
{ "error": "Sheet 'xxx' not found: ..." }
```

> 当前设计：HTTP 层永远 200，错误在 body 的 `error` 字段。客户端
> `BridgeClient.request` 检测 `data.error` 抛错。优点：简单，缺点：
> HTTP 层失去语义。建议下一版用真实 4xx/5xx 区分错误（见 HANDOFF）。

### 5.4 端点清单

#### Excel

| 方法 + 路径 | 请求体 | 响应 |
|---|---|---|
| `POST /api/excel/info` | `{ path }` | `ExcelInfo` |
| `POST /api/excel/columns` | `{ path, sheet }` | `ColumnInfo[]` |
| `POST /api/excel/sample` | `{ path, sheet, rows? }` | `SampleData` |
| `POST /api/excel/write` | `WriteResultsRequest` | `{ success: true }` |
| `POST /api/excel/apply-formula` | `ApplyFormulaRequest` | `{ success: true }` |
| `POST /api/excel/processing-status` | `{ path, sheet, resultColumn }` | `ProcessingStatus` |

#### Config

| 方法 + 路径 | 请求体 | 响应 |
|---|---|---|
| `POST /api/config/default` | — | `{ providerType, modelId }` |
| `GET /api/config/models` | — | `[{ name, providerType, modelId }]` |
| `POST /api/config/test` | `{ api_key, base_url, model_id }` | `{ success, error? }` ⚠ 当前未实装，返回 `not implemented` |

#### Prompts

| 方法 + 路径 | 请求体 | 响应 |
|---|---|---|
| `GET /api/prompts` | — | `Prompt[]` |
| `POST /api/prompts` | `{ name, content, category? }` | `Prompt` |

> 历史代码：早期 `POST /api/prompts` 用 `name+content` 字段判定，
> 后续应改为 `PromptInput` 统一。当前 `get_all_prompts` 走 SQLite，
> `save_prompt` 也走 SQLite（优先 DB，没有 DB 时降级到内存）。

#### Batch

| 方法 + 路径 | 请求体 | 响应 |
|---|---|---|
| `POST /api/batch/start` | `BatchParams` | `{ success: true }` |
| `POST /api/batch/pause` | `{ batchId }` | `{ success: true }` |
| `POST /api/batch/resume` | `{ batchId }` | `{ success: true }` |
| `POST /api/batch/stop` | `{ batchId }` | `{ success: true }` |
| `POST /api/batch/status` | `{ batchId }` | `{ success: true }` |

> 全部通过 `SidecarManager::send_batch_command` 写 stdin，由 Node.js
> `handleCommand` 路由到具体 `BatchRunner`。

#### Notification

| 方法 + 路径 | 请求体 | 响应 |
|---|---|---|
| `POST /api/events/notify` | 任意 | `{ success: true }` + `bridge-notification` 事件 |

### 5.5 客户端（Node.js）

`src-agent/src/bridge.ts`：

```ts
class BridgeClient {
  private baseUrl: string;
  constructor(port: number) { this.baseUrl = `http://127.0.0.1:${port}`; }

  private async request<T>(method, path, body?): Promise<T> {
    // AbortSignal.timeout(30_000) — 30s 超时
    // 解析 response.json()，若有 error 字段抛 Error
  }

  get<T>(path) => this.request<T>('GET', path);
  post<T>(path, body?) => this.request<T>('POST', path, body);

  getDefaultModel() => this.post<{providerType,modelId}>('/api/config/default');
  getAllModels() => this.get<...>('/api/config/models');
}
```

### 5.6 安全约束

- 仅监听 `127.0.0.1`（不暴露到 LAN）。
- 端口动态分配（OS 决定）。
- 启动 Sidecar 前必须先有端口，端口通过命令行参数注入，不写文件。
- 当前**没有**：CSRF 防御、来源校验、请求体大小限制（建议加 5MB 上限）。

---

## 6. 事件订阅与状态机

### 6.1 Agent 会话生命周期

```
App 启动
   │
   ▼
Sidecar spawn → stdout reader 启动
   │
   ▼
Node.js: import('./agent.js') → createSheetAgent(bridge)
   │   - getDefaultModel() → getModel()
   │   - createAgentSession({ model, tools, customTools, sessionManager })
   │
   ▼
emit('sidecar_ready') → Rust → agent-event
   │
   ▼
前端 AgentStore: 收到 type==='sidecar_ready' → status.ready = true
   │
   ▼
用户发送消息 → invoke('send_agent_message')
   │
   ▼
Sidecar stdin: {type:'user_message', id, content}
   │
   ▼
session.prompt(content)  ← Agent Loop
   │
   ├─► text_delta → emit('agent_delta') → React 流式渲染
   ├─► tool_start/end → emit('agent_tool_start/end')
   └─► end → emit('agent_done') → React 收尾
```

### 6.2 批量处理生命周期

```
中栏页面 or Agent 工具
   │
   ▼
Sidecar stdin: {type:'batch_start', params}
   │
   ▼
main.ts: handleBatchStart → new BatchRunner(bridge)
   │
   ▼
runner.run(params):
   for row in data.rows:
      if paused: wait
      if aborted: break
      if row already processed: skip
      try:
         result = await _processRowWithRetry (3x 指数退避)
         await bridge.post('/api/excel/write', {row, value: result})
         _saveCheckpoint(i+1)
         tracker.tick(i+1, result)
         emit('batch_row_complete', {row, result})
      catch:
         emit('batch_error', {message})
         break
   │
   ▼
emit('batch_done' | 'batch_error')
```

### 6.3 暂停 / 恢复

- `pause()`：置 `paused=true`，注册 `pausePromise` 等待。
- `resume()`：置 `paused=false`，resolve 等待。
- 在主循环每行开始时 `while(paused) await pausePromise`。

### 6.4 中止

- `abort()`：调 `AbortController.abort()`，主循环检测后退出并写
  checkpoint。**当前实现**在 `pause` 状态下 `abort()` 会先 `resume()`
  解除 pause 让循环能检测到 abort。

### 6.5 断点续传

- 文件：`cwd/.batch-checkpoints/checkpoint.json`。
- 内容：`{ processedCount: number, timestamp: number }`。
- 启动时：`_getCheckpoint()` 读取，决定 `resumeFrom`。
- 运行时：每行成功后 `_saveCheckpoint(i+1)`。
- 双保险：每行处理前还查 `processing-status` 跳过已写行。

### 6.6 Direct LLM 生命周期

直接 LLM 调用绕过 AgentSession，由 `runDirectLlmStream`（`direct-llm.ts`）
通过 `pi-ai` 的 `stream()` 发起单轮 LLM 调用。

```
前端 QuickActionBar 点击
   │
   ▼
agentStore.sendDirectLlmMessage()
   │   userMsg + assistantMsg(empty, streaming) → messages
   │   requestId = `direct-{millis}-{rand}`
   ▼
invoke('send_direct_llm_message', { requestId, action, content, context })
   │
   ▼
Sidecar stdin: { type:'direct_llm_message', id, action, content, context }
   │
   ▼
runDirectLlmStream(bridge, command, emit)
   │   getDefaultModel() → getModel() → applyApiKeyEnv()
   │   new AbortController()
   │   stream(model, { systemPrompt, messages:[{role:'user', content}] }, { signal })
   │
   ├─► text_delta → emit('agent_delta', { id: 'direct-...', delta })
   ├─► err → emit('agent_error', { id: 'direct-...', message })
   └─► done/abort → emit('agent_done', { id: 'direct-...' })
   │
   ▼
Rust Event Bridge → Tauri Events → agentStore.handleEvent
   │   按 event.id 前缀路由到 directStreamingRequestId
   │   匹配已有 assistant message（requestId === event.id）追加 delta
   ▼
完成 → directStreamingRequestId = null
```

**约束**：
- 仅单轮（不进入 AgentSession 的多轮上下文）。
- 支持 AbortController 取消（`stop` 命令触发 `abortDirectLlm()`）。
- API Key 通过 `applyApiKeyEnv` 注入环境变量，与 Agent/BatchRunner 一致。
- `id` 前缀为 `direct-`，前端按此区分 Agent 流与 Direct LLM 流。

---

## 7. 字段约定

### 7.1 命名

- Rust：`snake_case`（字段、模块）、`PascalCase`（结构体、枚举）。
- TypeScript：`camelCase`（属性）、`PascalCase`（类型/接口）。
- JSON over wire：`camelCase`（serde 默认）—— TypeScript 端无需转换。

### 7.2 时间

- 一律 ISO 8601 字符串（`chrono::Utc::now().to_rfc3339()` 或
  `new Date().toISOString()`）。
- 心跳：`new Date().toISOString()`。

### 7.3 ID

- 数据库主键：
  - `models` / `formula_cache`：`INTEGER AUTOINCREMENT` → number。
  - `prompts`：`TEXT PRIMARY KEY`（UUID v4）。
- Sidecar `id`：`{prefix}-{millis}` 格式字符串。
- 批量 `batchId`：`batch-{Date.now()}-{rand6}` 格式字符串。

### 7.4 空值

- Option 字段 JSON 序列化为 `null`。
- `Vec<T>` 空时为 `[]`。
- 字符串空时为 `""`（不是 `null`）。

---

## 8. 错误码 / 错误处理约定

### 8.1 Rust 端

`AppError` 枚举 + `Serialize` 实现 → 序列化为字符串：

```rust
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Sidecar is not running")]
    SidecarUnavailable,
    #[error("Sidecar command timed out")]
    SidecarTimeout,
    #[error("Sidecar error: {0}")]
    Sidecar(String),
    #[error("Service error: {0}")]
    Service(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Excel error: {0}")]
    Excel(String),
    #[error("Database error: {0}")]
    Database(String),
}
```

### 8.2 Tauri IPC 返回

`Result<T, AppError>` → `T` 或 `e.to_string()`。

### 8.3 Sidecar 错误

`agent_error` 事件：

```json
{ "type":"agent_error", "id":"msg-...", "message":"API 401 Unauthorized" }
```

### 8.4 HTTP Bridge 错误

`{ "error": "..." }` body + HTTP 200。

### 8.5 前端错误传播

```
AppError（Rust） ── invoke 抛错 ──► invoke().catch(set error)
agent_error 事件 ── listen ──► AgentStore.error
batch_error 事件 ── listen ──► processingStore.addLog({level:'error'})
HTTP error body ── BridgeClient.request() throw ──► Agent 工具 execute() 报错回流
```

---

## 9. 版本与兼容

| 层 | 版本策略 |
|---|---|
| Rust crate | `Cargo.lock` 锁版本 |
| Node package | `package-lock.json` 锁版本 |
| pi-agent SDK | 0.78.1（固定） |
| Tauri | 2.x |
| 协议字段 | 新增字段向后兼容；删字段需要双方同步升级 |

---

**文档版本**：v1.0  
**更新日期**：2026-06-07
