# 通用 App Agent 集成实践方案

> 基于 Tolaria 项目 CLI Coding Agent 编排模式的提取与迁移指南。
> DeepWiki项目分析文档：https://deepwiki.com/refactoringhq/tolaria/9-ai-integration

---

## 1 模式定名：外部 CLI Agent 编排模式（External CLI Agent Orchestration）

Tolaria 的 AI 子系统并非实现 A2A（Agent-to-Agent）协议，而是采用 **外部 CLI Agent 编排模式**：应用作为编排层，以子进程方式启动一个或多个外部 Coding Agent，约定 stdin/stdout JSON Lines 事件流进行双向通信，并通过注入 MCP Server 赋予 Agent 访问应用领域能力的权限。

```
┌─────────────────────────────────────────────────────────────┐
│                       App 进程边界                           │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐ │
│  │  Frontend   │◄─────►│  Backend    │◄─────►│   MCP       │ │
│  │  (React)    │ IPC   │  (Rust)  │       │  Server     │ │
│  └─────────────┘      └──────┬──────┘      └─────────────┘ │
│                              │  spawn / JSON stream        │
└──────────────────────────────┼──────────────────────────────┘
                                │
                      ┌─────────▼──────────┐
                      │  外部 CLI Agent    │
                      │  (Claude Code /    │
                      │   Codex / Gemini   │
                      │   CLI 等)          │
                      └────────────────────┘
```

---

## 2 核心设计决策

| 决策点 | Tolaria 的选型 | 其他项目可替换方案 |
|---|---|---|
| Agent 启动方式 | 子进程 spawn (stdin/stdout) | 同左 / HTTP SSE / gRPC stream |
| 通信协议 | JSON Lines (NDJSON) | 同左 |
| Agent 能力注入 | MCP Server (stdio 注入) | 同左 / 函数调用 RPC |
| Agent 发现 | PATH + 多路径探测 | 同左 / 注册中心 |
| 权限控制 | Safe / Power User 两级 | 同左 / 基于角色的工具白名单 |
| Agent 会话状态 | 前端维护，后端无状态 | 同左 / 后端持久化 |

### 为什么不选 A2A 协议

1. **目标 Agent 已有成熟 CLI**：Claude Code、Codex CLI、Gemini CLI 均已提供成熟的命令行接口，无需重复包装。
2. **进程隔离**：子进程天然隔离，Agent 崩溃不拖垮宿主应用，资源可回收。
3. **MCP 生态对齐**：当前主流外部 Agent 均支持 MCP，直接复用协议即可打通领域能力。
4. **实现成本低**：无需标准化协商，只需约定 JSON 事件 Schema。

---

## 3 整体架构（三层）

```
┌───────────────────────────────────────────────────────────────────┐
│  Layer 3 · 外部层                                                   │
│  Claude Code · Codex CLI · Gemini CLI · OpenCode · Pi · Kiro       │
│  [通过 MCP 访问 App 领域能力]                                        │
├───────────────────────────────────────────────────────────────────┤
│  Layer 2 · 编排层                                                    │
│  Agent Registry · Event Normalizer · Permission Enforcer            │
│  CliRuntime (spawn + JSON-Line 解析 + 错误处理)                      │
├───────────────────────────────────────────────────────────────────┤
│  Layer 1 · 基础设施层                                                  │
│  MCP Server (stdio) · 命令通道 · 文件系统 / Git / 搜索等 Domain Tools│
└───────────────────────────────────────────────────────────────────┘
```

---

## 4 通信流程（请求-响应生命周期）

```
User → Frontend: 发送消息
Frontend → Backend: stream_ai_agent({ agent, message, systemPrompt, vaultPath, permissionMode, eventName })
Backend: 选择对应 Adapter
Backend → Agent Process: spawn + stdin 写入 prompt（JSON stream 格式）
    ↓
    ┌── 并行 stdout/stderr 读取循环 ──┐
    │ Agent 输出: JSON Lines          │
    │  Backend: 解析并标准化事件      │
    │  Backend → Frontend:  emit      │
    │    { TextDelta | ThinkingDelta  │
    │    | ToolStart | ToolDone       │
    │    | Error | Done }             │
    └────────────────────────────────┘
    ↓
Agent → MCP Server: 调用 domain tools (search_notes, get_note, create_note …)
MCP Server → Agent: 返回工具结果
    ↓
Agent 输出 Done 或 Error → Backend → Frontend
Frontend: 渲染完整对话 + 调用文件刷新检测
```

### 事件 Schema（标准化层）

```rust
// 所有 Adapter 最终统一为：
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum AiAgentStreamEvent {
  Init      { session_id: String },
  TextDelta { text: String },
  ThinkingDelta { text: String },
  ToolStart { tool_name: String, tool_id: String, input: Option<String> },
  ToolDone  { tool_id: String, output: Option<String> },
  Error     { message: String },
  Done,
}
```

#### Claude 原始事件类型（Claude 特有的子类型，需映射到 AiAgentStreamEvent）

Claude Code 使用 `claude -p` 或 `claude --output-format stream-json` 会产生以下原始事件类型，通过 `map_claude_event()` 映射到统一事件：

- `Init { session_id }` — 会话开始
- `TextDelta { text }` — 文本增量
- `ThinkingDelta { text }` — 思考过程增量
- `ToolStart { tool_name, tool_id, input }` — 工具调用开始
- `ToolDone { tool_id, output }` — 工具调用完成
- `Error { message }` — 错误
- `Done` — 完成
- `Result { text, session_id }` — **Claude 特有**：本次处理的最终结果文本，空文本会被忽略，非空则映射为 `TextDelta`

重要：每当 Agent 输出 Done 或 Error 后，Frontend 需触发文件刷新检测（通过 Tool 的 input/output 解析文件路径）。

---

## 5 各层详细设计

### 5.1 Frontend 层

#### 5.1.1 核心文件索引

| 文件 | 职责 | 优先级 |
|---|---|---|
| `src/lib/aiAgents.ts` | Agent 注册表 + 状态归一化 | ⭐⭐⭐ 必读 |
| `src/lib/aiTargets.ts` | Agent/Model 双轨目标系统 | ⭐⭐⭐ 必读 |
| `src/lib/aiAgentSession.ts` | 会话生命周期编排 | ⭐⭐⭐ 必读 |
| `src/lib/aiAgentStreamCallbacks.ts` | 流事件回调 | ⭐⭐⭐ 必读 |
| `src/lib/aiAgentFileOperations.ts` | 文件操作检测 | ⭐⭐⭐ 必读 |
| `src/lib/aiAgentPermissionMode.ts` | 安全模式定义 | ⭐⭐⭐ 必读 |
| `src/utils/streamAiAgent.ts` | Tauri IPC 调用封装 | ⭐⭐⭐ 必读 |
| `src/utils/aiStreamEvents.ts` | 流事件名 UUID 作用域生成 | ⭐⭐⭐ 必读 |
| `src/utils/ai-agent.ts` | System Prompt 构建 | ⭐⭐⭐ 必读 |
| `src/utils/ai-chat.ts` | 历史消息格式化 + token 截断 | ⭐⭐⭐ 必读 |
| `src/utils/ai-reference-content.ts` | Reference content utilities | ⭐⭐ |
| `src/utils/aiProviderSecrets.ts` | API key management | ⭐⭐ |
| `src/utils/aiPromptBridge.ts` | Prompt bridge utilities | ⭐⭐ |

#### 5.1.2 Agent Registry (`src/lib/aiAgents.ts`)

职责：定义支持的 Agent 列表、默认值、安装状态归一化。

```typescript
// 核心类型
export type AiAgentId = 'claude_code' | 'codex' | 'opencode' | 'pi' | 'gemini' | 'kiro'

export interface AiAgentDefinition {
  id: AiAgentId
  label: string
  shortLabel: string
  installUrl: string
}

// Agent 可用性状态
export type AiAgentStatus = 'checking' | 'installed' | 'missing'
export interface AiAgentAvailability {
  status: AiAgentStatus
  version: string | null
}
```

关键函数：
- `normalizeAiAgentsStatus()` — 将后端检测结果转为前端标准状态
- `hasAnyInstalledAiAgent()` — 首次启动门控
- `getNextAiAgentId()` — 循环切换 Agent（用于 preference 轮换）

#### 5.1.3 Target 系统 (`src/lib/aiTargets.ts`)

支持两种目标类型：

```typescript
// Agent 目标（外部 CLI）
type AgentTarget = { kind: 'agent'; agent: AiAgentId; id: `agent:${AiAgentId}` }

// API Model 目标（直接 OpenAI/Anthropic API）
type ModelTarget = { kind: 'api_model'; provider: AiModelProvider; model: AiModelDefinition; id: `model:${provider}/${model}` }
```

- `resolveAiTarget(settings)` — 根据存储的偏好解析当前默认目标
- `agentTargets()` — 列出所有 Agent 目标
- `configuredModelTargets(providers)` — 列出所有已配模型目标

#### 5.1.4 会话生命周期 (`src/lib/aiAgentSession.ts`)

```
sendAgentMessage()
  1. 校验前置条件（vault 是否加载、Agent 是否可用、状态是否空闲）
  2. 构建 formattedMessage + systemPrompt
  3. 创建 Streaming Message UI 占位
  4. 调用 streamAiAgent / streamAiModel
  5. 流结束后更新 message response
```

```typescript
export interface AiAgentSessionRuntime {
  setMessages: Dispatch<SetStateAction<AiAgentMessage[]>>
  setStatus: Dispatch<SetStateAction<AgentStatus>>
  abortRef: MutableRefObject<{ aborted: boolean }>
  responseAccRef: MutableRefObject<string>
  fileCallbacksRef: MutableRefObject<AgentFileCallbacks | undefined>
  toolInputMapRef: MutableRefObject<Map<string, ToolInvocation>>
  messagesRef: MutableRefObject<AiAgentMessage[]>
}
```

#### 5.1.5 Streaming Callbacks (`src/lib/aiAgentStreamCallbacks.ts`)

每个流事件对应一个回调，由 Backend 通过 WebSocket 或 Event 推送至 Frontend：

| 回调 | 行为 |
|---|---|
| `onThinking(chunk)` | 累加到 `reasoning` 字段（可折叠） |
| `onText(chunk)` | 累加到 `responseAccRef`，折叠思考区 |
| `onToolStart(name, id, input)` | 创建 `AiActionCard` 并标记 pending |
| `onToolDone(id, output)` | 更新对应 card 为 done，触发文件操作检测 |
| `onError(msg)` | 标记 error，部分回复落盘 |
| `onDone()` | 最终化 message，触发文件刷新 |

#### 5.1.6 文件操作检测 (`src/lib/aiAgentFileOperations.ts`)

从 Tool 的 `input` JSON 中解析文件路径，映射到 vault 相对路径，触发：
- `onFileCreated(relativePath)` — 新建笔记
- `onFileModified(relativePath)` — 编辑笔记
- `onVaultChanged()` — 无法识别的写操作回退全量刷新

#### 5.1.7 权限模式 (`src/lib/aiAgentPermissionMode.ts`)

```typescript
export type AiAgentPermissionMode = 'safe' | 'power_user'

// Safe: 仅 MCP 工具，无 Shell
// Power User: MCP + Shell（范围限制在 vault 目录内）
```

#### 5.1.8 前端的并发流事件作用域机制（关键）

为了避免并发的 Agent 请求产生 WebSocket 事件冲突，Frontend 使用 UUID 作用域的事件名：

```typescript
// src/utils/aiStreamEvents.ts
export function createScopedStreamEventName(base: string): string {
  // 例如生成 "ai-agent-stream-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Backend 的 `AiAgentStreamRequest` 结构体包含 `event_name: Option<String>` 字段，用于透传客户端的 scoped 事件名。`stream_ai_agent` Tauri 命令监听这个 scoped 事件名以避免多路冲突。

#### 5.1.9 前端 Hooks (`src/hooks/`)

- `useCliAiAgent` — 核心 orchestrator：构建上下文 → 调用 stream → 处理回调
- `useAiAgentsStatus` — 轮询 Agent 安装状态
- `useAiAgentsOnboarding` — 控制 onboarding 弹窗可见性
- `useAiAgentPreferences` — 管理默认 Agent / 权限偏好
- `useAppPreferences` — 整合 AI 偏好到全局设置
- `useAiPanelController` — 面板状态机管理
- `useAiPanelPromptQueue` — 队列化用户输入（Agent 忙碌时排队）
- `useAiPanelFocus` — 编辑器聚焦管理

#### 5.1.10 前端组件

| 组件 | 职责 |
|---|---|
| `AiPanel.tsx` | 核心聊天面板（消息列表 + 输入框 + header） |
| `AiMessage.tsx` | 单条消息渲染（用户消息、助手回复、Thinking、ActionCard） |
| `AiActionCard.tsx` | Tool 调用的卡片（spinner → 输出） |
| `AiAgentIcon.tsx` | 6 个 Agent 的 SVG 图标映射 |
| `AiAgentsOnboardingPrompt.tsx` | 首次启动：检查已安装 Agent，提示安装 |
| `AiWorkspace.tsx` | 多窗口工作台（dock 面板或 pop-out native 窗口） |
| `AiWorkspaceChrome.tsx` | Workspace 顶栏 |
| `AiWorkspaceSidebar.tsx` | Workspace 侧栏 |
| `AiWorkspaceWindowApp.tsx` | 独立窗口 AI workspace |
| `AiPanelChrome.tsx` | 当前 Agent + 权限模式选择器 |

---

### 5.2 Backend 层（Rust）

#### 5.2.1 模块结构（实际代码结构）

实际文件为扁平结构，位于 `src-tauri/src/` 根下:

```
src-tauri/src/
├── ai_agents.rs            # 中央编排器
├── cli_agent_runtime.rs    # 共享 spawn + JSON stream 框架
├── claude_cli.rs           # Claude Code Adapter
├── claude_invocation.rs    # Claude CLI 参数构造
├── codex_cli.rs            # Codex CLI Adapter
├── opencode_cli.rs         # OpenCode CLI Adapter
├── opencode_config.rs      # OpenCode 配置生成
├── opencode_discovery.rs   # OpenCode 二进制发现
├── opencode_events.rs      # OpenCode JSON 事件解析
├── pi_cli.rs               # Pi CLI Adapter
├── pi_config.rs            # Pi 配置生成
├── pi_discovery.rs         # Pi 二进制发现
├── pi_events.rs            # Pi 事件解析
├── gemini_cli.rs           # Gemini CLI Adapter
├── gemini_config.rs        # Gemini 配置生成
├── gemini_discovery.rs     # Gemini 二进制发现
├── kiro_cli.rs             # Kiro CLI Adapter
├── kiro_discovery.rs       # Kiro 二进制发现
├── commands/
│   └── ai.rs               # Tauri IPC 命令绑定
└── mcp/
    ├── paths.rs            # MCP 配置路径解析
    ├── subprocess.rs       # MCP 子进程管理
    ├── opencode.rs         # OpenCode MCP 格式
    └── extraction.rs       # Linux AppImage 资源提取
```

#### 5.2.2 中央编排器 (`ai_agents.rs`)

```rust
pub enum AiAgentId { ClaudeCode, Codex, Opencode, Pi, Gemini, Kiro }

pub async fn get_ai_agents_status() -> AiAgentsStatus
pub fn run_ai_agent_stream<F>(request: AiAgentStreamRequest, emit: F) -> Result<String, String>
```

`run_ai_agent_stream` 根据 `request.agent` 分发到对应 Adapter：

- `claude_cli::run_agent_stream()`
- `codex_cli::run_agent_stream()`
- `opencode_cli::run_agent_stream()`
- `pi_cli::run_agent_stream()`
- `gemini_cli::run_agent_stream()`
- `kiro_cli::run_agent_stream()`

**关键点**：Claude 先产生 `ClaudeStreamEvent`，经过 `map_claude_event()` 映射后统一为 `AiAgentStreamEvent` 再 emit。其余五个 Adapter 直接 emit `AiAgentStreamEvent`。

#### 5.2.3 标准化事件类型 (`ai_agents.rs`)

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum AiAgentStreamEvent {
  Init      { session_id: String },
  TextDelta { text: String },
  ThinkingDelta { text: String },
  ToolStart { tool_name: String, tool_id: String, input: Option<String> },
  ToolDone  { tool_id: String, output: Option<String> },
  Error     { message: String },
  Done,
}
```

#### 5.2.4 请求/响应结构体 (`ai_agents.rs`)

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct AiAgentStreamRequest {
  pub agent: AiAgentId,
  pub message: String,
  pub system_prompt: Option<String>,
  pub vault_path: String,
  #[serde(default)]
  pub vault_paths: Vec<String>,
  pub permission_mode: Option<AiAgentPermissionMode>,
  #[serde(default)]
  pub event_name: Option<String>,  // scoped event name for concurrent streams
}
```

#### 5.2.5 CLI Adapter Pattern

每个 Agent 的 Adapter 遵循统一签名：

```rust
pub struct AgentStreamRequest {
  pub message: String,
  pub system_prompt: Option<String>,
  pub vault_path: String,
  pub vault_paths: Vec<String>,
  pub permission_mode: AiAgentPermissionMode,
}

// 返回 Result<session_id, error>
pub fn run_agent_stream(request: AgentStreamRequest, emit: impl FnMut(AgentStreamEvent)) -> Result<String>
```

注意：Claude adapter 使用自己的 `ClaudeStreamEvent`，由 `ai_agents.rs` 中的 `map_claude_event()` 负责转换。

**关键实现细节**：

1. **进程启动**：通过 `std::process::Command::new(binary_path)` 启动
2. **MCP 注入**：将 Tolaria MCP Server 路径/配置作为参数传入 Agent
3. **输入注入**：stdin 写入 prompt JSON
4. **输出解析**：逐行读取 stdout/stderr，解析为结构化事件
5. **超时与取消**：支持 tokio::select! + abort handle
6. **错误恢复**：进程 panic 时返回标准化错误事件

### 5.2.6 权限模式实现（按 Adapter 对比表）

Safe / Power User 的具体实现方式因 Agent 而异：

| Adapter | Safe 模式 | Power User 模式 |
|---|---|---|
| Claude | `--allowedTools` 仅允许文件/搜索/编辑工具，**排除 Bash** | `--allowedTools` 加入 Bash；Shell 命令仅在 vault 目录内执行 |
| Codex | `--sandbox read-only --ask-for-approval untrusted exec --json` | `--sandbox workspace-write --ask-for-approval never exec --json` |
| OpenCode | `run --format json` + transient config 禁止 bash 和外部目录 | 允许 bash 但禁止外部目录写入 |
| Pi | 仅 Tolaria MCP（不暴露 Shell，prompt 中声明 shell 不可用） | 同 Safe（未实际开放 Shell） |
| Gemini | `auto_edit` + `tools.exclude=["run_shell_command"]` | `yolo` + 信任 Tolaria MCP |
| Kiro | `--trust-all-tools`（两端相同） | 同 Safe |

### 5.2.7 Binary Discovery 实现

共享框架位于 `cli_agent_runtime.rs`，但每个 Agent 可以覆盖自定义逻辑。

**查找顺序（按优先级）**：
1. 当前进程 PATH
2. 用户登录 shell PATH（`bash -lc 'command -v xxx'`）
3. 常见工具目录：
   - `~/.local/bin`
   - `~/.claude/local`
   - Mise/asdf shims
   - nvm managed Node
   - npm global
   - Homebrew (macOS)
   - `%APPDATA%\npm` (Windows)
   - Scoop shims (Windows)
   - `.exe` launchers
   - 应用资源路径（如 Codex macOS）
4. 扩展 PATH 传给子进程

**Windows `.cmd` shim 特殊处理**：
在 `cli_agent_runtime` 中有显式的 `windows_cmd_shim` 检测逻辑。桌面应用从 GUI 启动时，Node.js Agent 通常是 `.cmd` 脚本，无法直接 `spawn`。运行时通过解析 `.cmd` 找到对应的 `.js` 入口或 Node.js 路径。

**Shell 环境传播**：
`shell_env()` 会调用用户登录 shell 获取环境（包括 `ANTHROPIC_API_KEY`、`PATH` 等），这对于 GUI 桌面应用尤其重要，因为桌面应用默认不继承终端环境。

#### 5.2.8 Commands (`src-tauri/src/commands/ai.rs`)

Tauri IPC 命令绑定层（实际代码）：

```rust
#[tauri::command]
async fn stream_ai_agent(
  agent: AiAgentId,
  message: String,
  system_prompt: Option<String>,
  vault_path: String,
  vault_paths: Vec<String>,
  permission_mode: Option<AiAgentPermissionMode>,
  event_name: Option<String>,
) -> Result<(), String>
// 内部调用 run_ai_agent_stream::<F>(request, emit)
```

注意：
- `vault_path` 在进入 Rust 前通过 `normalize_agent_request` 展开 `~` 为绝对路径
- `event_name` 用于生成 scoped event name（前端生成 UUID，通过此字段透传）
- 另有一个并行的 `stream_ai_model` 命令处理 API model targets（OpenAI/Anthropic 直连）

---

### 5.3 MCP Server 层

#### 5.3.1 设计目标与职责边界

`MCP Server` 是 App 面向外部 Agent 的 **RPC 接口层**，将应用领域能力以标准化 MCP Tool 形式暴露给外部 Agent。

> ⚠️ 重要区分：`src-tauri/src/mcp.rs` **不是** MCP Server 本身，而是宿主编排层对 MCP 生命周期的管理胶水：
> - 查找 Node.js/Bun 运行时
> - 注册/卸载 Tolaria 到外部 Agent 的 MCP 配置文件中
> - spawn `mcp-server/ws-bridge.js` 子进程
> - 检查注册状态
>
> **真正的 MCP Tool 实现在 `mcp-server/tool-service.js`**（Node.js 进程）。

#### 5.3.2 Tool Surface（`mcp-server/tool-service.js`）

| Tool | Params | 描述 |
|---|---|---|
| `search_notes` | `query`, `[limit]` | 按标题/内容全文搜索 |
| `get_vault_context` | `[vaultPath]` | 获取 vault 元信息（types, folders, recent notes, AGENTS.md） |
| `list_vaults` | — | 列出所有 mounted vaults 及 AGENTS.md 状态 |
| `get_note` | `path`, `[vaultPath]` | 按路径读取笔记内容 |
| `create_note` | `path`, `content`, `[title]`, `[type]`, `[vaultPath]` | 创建新笔记（不覆盖） |
| `open_note` | `path`, `[vaultPath]` | 在 App UI 中打开笔记（同时返回内容） |
| `highlight_editor` | `element`, `[path]` | 高亮指定 UI 元素 |
| `refresh_vault` | `[path]`, `[vaultPath]` | 触发 vault 重新扫描 |

**别名（在 ws-bridge.js 中转发）：**
- `read_note` → 同 `open_note`（返回内容）
- `ui_open_note` → 调用 `openNoteInEditor`（UI action）
- `ui_open_tab` → 调用 `openNoteAsTab`（UI action）
- `ui_highlight` → 同 `highlight_editor`
- `ui_set_filter` → 调用 `setFilter`

#### 5.3.3 注入方式

外部 Agent 通过不同的配置路径获得 MCP Server 引用：

| Agent | 注入方式 |
|---|---|
| Claude Code | `~/.claude.json` 或 `~/.claude/mcp.json` 标准 MCP 配置 |
| Codex CLI | 临时 `-c mcp_servers.tolaria.*` 覆写 |
| OpenCode | `OPENCODE_CONFIG_CONTENT` 环境变量 + `~/.config/opencode/opencode.json` |
| Gemini CLI | `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 临时设置文件 |
| Kiro CLI | `.kiro/settings/mcp.json` |
| 其他 MCP Client | 手动复制生成的 MCP 配置 JSON |

#### 5.3.4 Transport

- **stdio**: Claude Code 等使用 stdio transport（`node mcp-server/index.js`）
- **WebSocket**: App 内部 bridge — Port 9710 = Tool bridge 服务端, Port 9711 = UI action 事件广播客户端

其中 Port 9710 内部代理 stdio MCP，将外部 Agent 通过 WebSocket 发来的 MCP 请求转发给 `mcp-server`；Port 9711 是 `mcp-server` 作为 WebSocket client 连回 App 的 UI action 广播链路。

#### 5.3.5 ws-bridge 生命周期管理

ws-bridge 是 `mcp-server/ws-bridge.js` 子进程，作为 vault 和 MCP server 之间的桥梁。它在 `src-tauri/src/lib.rs` 中以 `Mutex<Option<Child>>` 管理，在 vault 切换时会 kill 并 respawn。

#### 5.3.6 迁移到其他项目时的职责映射

如果你的项目不是笔记软件，需要把 `mcp-server/tool-service.js` 中的工具替换为自己的领域能力：

```
原 Tolaria 笔记工具              替换为你的领域工具
─────────────────────────────────────────────────
open_note(path)              →  read_document(id)
create_note(path, content)   →  create_ticket(title, body)
search_notes(query)          →  search_issues(query)
get_vault_context()          →  project_context()
highlight_editor(element)    →  highlight_element(element)
refresh_vault()              →  invalidate_cache()
```

`mcp.rs` 中的运行时查找和 Config 注册逻辑**可以直接复用**，无需修改。

---

## 6 关键数据结构

### 6.1 适配器请求/响应

```rust
// 请求
pub struct AiAgentStreamRequest {
  pub agent: AiAgentId,
  pub message: String,
  pub system_prompt: Option<String>,
  pub vault_path: String,
  pub vault_paths: Vec<String>,   // 多 vault
  pub permission_mode: Option<AiAgentPermissionMode>,
  pub event_name: Option<String>, // scoped event name
}

// 标准化事件
pub enum AiAgentStreamEvent {
  Init { session_id: String },
  TextDelta { text: String },
  ThinkingDelta { text: String },
  ToolStart { tool_name: String, tool_id: String, input: Option<String> },
  ToolDone  { tool_id: String, output: Option<String> },
  Error     { message: String },
  Done,
}
```

**注意**：Claude adapter 输出自己的 `ClaudeStreamEvent`，包含一个额外的 `Result { text, session_id }` 变体。该变体在 `ai_agents.rs` 的 `map_claude_event()` 中被转换成 `TextDelta`（若文本非空）或忽略（若文本为空）。

### 6.2 Frontend 内部消息模型

```typescript
interface AiAgentMessage {
  userMessage: string
  references?: NoteReference[]
  localMarker?: string          // 系统提示标记（非用户消息）
  reasoning?: string            // 思考过程（可折叠）
  reasoningDone?: boolean
  actions: AiAction[]           // Tool 调用列表
  response?: string
  isStreaming?: boolean
  id?: string
}

interface AiAction {
  toolId: string
  tool: string
  input?: string
  status: 'pending' | 'done' | 'error'
  output?: string
}
```

---

## 7 参考文件索引

所有参考文件已复制到 `agent-integration-reference/` 目录，按层组织。

### 7.1 Frontend 核心逻辑（`core-frontend/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `aiAgents.ts` | Agent 注册表 | ⭐⭐⭐ 必读 |
| `aiTargets.ts` | Agent / Model 目标系统 | ⭐⭐⭐ 必读 |
| `aiAgentSession.ts` | 会话生命周期 | ⭐⭐⭐ 必读 |
| `aiAgentStreamCallbacks.ts` | 流事件回调 | ⭐⭐⭐ 必读 |
| `aiAgentFileOperations.ts` | 文件操作检测 | ⭐⭐⭐ 必读 |
| `aiAgentPermissionMode.ts` | 安全模式定义 | ⭐⭐⭐ 必读 |
| `streamAiAgent.ts` | Tauri IPC 调用 | ⭐⭐⭐ 必读 |
| `aiStreamEvents.ts` | 流事件 UUID 作用域 | ⭐⭐⭐ 必读 |
| `ai-agent.ts` | System Prompt 构建 | ⭐⭐ |
| `ai-chat.ts` | 历史消息格式化 + token 截断 | ⭐⭐ |

### 7.2 Frontend Hooks（亦在 `core-frontend/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `useCliAiAgent.ts` | 核心 orchestrator | ⭐⭐⭐ 必读 |
| `useAiAgentsStatus.ts` | 轮询 Agent 安装状态 | ⭐⭐ |
| `useAiAgentsOnboarding.ts` | onboarding 弹窗 | ⭐⭐ |
| `useAiAgentPreferences.ts` | 默认 Agent / 权限偏好 | ⭐⭐ |
| `useAppPreferences.ts` | 整合 AI 偏好到全局设置 | ⭐ |

### 7.3 Frontend 组件（`frontend-components/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `AiPanel.tsx` | 主聊天面板 | ⭐⭐⭐ |
| `AiMessage.tsx` | 消息渲染 | ⭐⭐⭐ |
| `AiActionCard.tsx` | Tool 调用卡片 | ⭐⭐ |
| `useAiPanelController.ts` | 面板控制器 | ⭐⭐ |
| `AiAgentIcon.tsx` | Agent 图标映射 | ⭐ |
| `AiAgentsOnboardingPrompt.tsx` | 首次引导 | ⭐ |
| `AiWorkspace.tsx` | 多窗口工作台 | ⭐ |
| `AiWorkspaceChrome.tsx` | Workspace 顶栏 | ⭐ |
| `AiWorkspaceSidebar.tsx` | Workspace 侧栏 | ⭐ |
| `AiWorkspaceWindowApp.tsx` | 独立窗口 | ⭐ |

### 7.4 Backend Adapters（`backend-adapters/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `ai_agents.rs` | 中央编排、状态聚合、事件分发 | ⭐⭐⭐ 必读 |
| `cli_agent_runtime.rs` | 共享框架（spawn + JSON stream） | ⭐⭐⭐ 必读 |
| `claude_cli.rs` | Claude Code Adapter 完整实现 | ⭐⭐⭐ |
| `claude_invocation.rs` | Claude CLI 参数构造 | ⭐⭐⭐ |
| `codex_cli.rs` | Codex CLI Adapter | ⭐⭐ |
| `gemini_cli.rs` | Gemini CLI Adapter | ⭐⭐ |
| `opencode_cli.rs` | OpenCode CLI Adapter | ⭐⭐ |
| `opencode_config.rs` | OpenCode 配置生成 | ⭐ |
| `opencode_discovery.rs` | OpenCode 二进制发现 | ⭐ |
| `opencode_events.rs` | OpenCode JSON 事件解析 | ⭐ |
| `pi_cli.rs` | Pi CLI Adapter | ⭐ |
| `pi_config.rs` | Pi 配置生成 | ⭐ |
| `pi_discovery.rs` | Pi 二进制发现 | ⭐ |
| `pi_events.rs` | Pi 事件解析 | ⭐ |
| `gemini_config.rs` | Gemini 配置生成 | ⭐ |
| `gemini_discovery.rs` | Gemini 二进制发现 | ⭐ |
| `kiro_cli.rs` | Kiro CLI Adapter | ⭐ |
| `kiro_discovery.rs` | Kiro 二进制发现 | ⭐ |
| `commands_ai.rs` | Tauri IPC 命令绑定 | ⭐⭐ |

### 7.5 MCP Server（`mcp-server-baseline/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `mcp.rs` | MCP Server Rust 入口 | ⭐⭐⭐ |
| `paths.rs` | MCP 配置路径解析 | ⭐⭐ |
| `subprocess.rs` | MCP 子进程管理 | ⭐⭐ |
| `opencode.rs` | OpenCode MCP 配置格式 | ⭐ |
| `extraction.rs` | Linux AppImage 资源提取 | ⭐ |

### 7.6 MCP Server Node.js（`mcp-server-baseline/`）

| 文件 | 职责 | 优先级 |
|---|---|---|
| `index.js` | MCP Server 入口 | ⭐⭐⭐ |
| `tool-service.js` | Tool 实现 | ⭐⭐⭐ |
| `ws-bridge.js` | WebSocket bridge | ⭐⭐⭐ |
| `vault.js` | Vault 上下文 | ⭐⭐ |
| `vault-path.js` | 路径工具 | ⭐ |
| `package.json` | 依赖声明 | ⭐ |

---

## 8 实施步骤（5 步）

### Step 1：定义 Agent Register

确定需要集成的外部 Agent 列表，在 Frontend 和 Rust 同时定义 Registry。

```typescript
// frontend (src/lib/aiAgents.ts)
export const AGENT_REGISTRY: AgentDefinition[] = [
  { id: 'your_agent_1', label: 'Agent 1', binary: 'agent1', installUrl: 'https://...' },
  { id: 'your_agent_2', label: 'Agent 2', binary: 'agent2', installUrl: 'https://...' },
]
```

```rust
// backend (Rust) — src-tauri/src/ai_agents.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AiAgentId { Agent1, Agent2 /* ... */ }
```

### Step 2：实现 CLI Binary Discovery

编写每个 Agent 的 `check_cli()` 和 `find_binary()` 函数，复用 Tolaria 的多路径查找策略。

关键细节：
- 使用 `shell_env()` 获取用户终端环境
- 在 Windows 上处理 `.cmd` shim
- 合并多路径到 PATH 后 spawn 子进程

参考：`agent-integration-reference/backend-adapters/cli_agent_runtime.rs`

### Step 3：编写 Adapter（最核心）

为每个 Agent 实现 `AgentStreamRequest → Result<String, emit>` 的适配器。

**最小实现模板**：

```rust
pub fn run_agent_stream(
  request: AgentStreamRequest,
  mut emit: impl FnMut(AgentStreamEvent),
) -> Result<String, String> {
  let mut child = Command::new(find_binary("your_agent"))
    .args(["--output-format", "stream-json", "--prompt"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| e.to_string())?;

  // 1. 写入 prompt 到 stdin
  // 2. 逐行读取 stdout，解析 JSON → AgentStreamEvent
  // 3. 调用 emit(event)
  // 4. 等待 Done / Error
}
```

参考：`agent-integration-reference/backend-adapters/claude_cli.rs`（最完整，含 `claude_invocation.rs`）

### Step 4：实现 MCP Server（可选但推荐）

在 App 端实现 MCP Server，暴露领域能力给 Agent。至少包含：
- `search_tools(query)` — 代码/文档搜索
- `read_file(path, offset, limit)` — 受限的文件读取
- `write_file(path, content)` — 受限的文件写入
- `run_command(command, timeout)` — 受限的命令执行（Safe 模式下禁用）

参考：`agent-integration-reference/mcp-server-baseline/index.js` + `tool-service.js`

### Step 5：前端接入

```typescript
// 最小接入：
// 1. 定义 Agent 状态轮询 hook
// 2. 实现 streamAiAgent() 函数（调用 Tauri IPC），注意使用 scoped event name
// 3. 实现 createStreamCallbacks() 映射事件到 UI 更新
// 4. 构建 sendAgentMessage() 编排逻辑
// 5. 实现 AiPanel 组件

// 文件顺序：
streamAiAgent.ts → aiAgentSession.ts → aiAgentStreamCallbacks.ts → aiStreamEvents.ts → AiMessage.tsx → AiPanel.tsx
```

---

## 9 技术选型建议

| 场景 | 推荐方案 |
|---|---|
| 已有 Tauri/Electron 桌面应用 | Rust/TS 双栈 + stdio JSON stream |
| 纯 Web 应用 | Web Worker + HTTP SSE 或 WebSocket |
| 已有 Go 后端 | Go 协程 + JSON stream (Tolaria 模式可直接 Go 实现) |
| 已有 Python 后端 | asyncio + subprocess + aiohttp（效果相同） |
| 低延迟要求 | Unix Domain Socket / gRPC stream |
| 需要 Agent 间协作 | **升级为 A2A 协议**（当前模式不支持 Agent 间直接通信） |

---

## 10 典型依赖

| 依赖 | 用途 |
|---|---|
| tokio (Rust) | async 子进程管理 |
| serde_json | JSON 流解析 |
| tauri | 桌面 IPC |
| @modelcontextprotocol/sdk | MCP Server 实现 |
| vitest / cargo test | 测试框架 |

---

## 11 注意事项

1. **不要在子进程中共享长期连接**：每次用户发送消息都新建子进程，或确保会话可恢复。
2. **PATH 扩展必做**：桌面应用从 GUI 启动时，通常不继承终端 PATH，需要手动探测并传递完整 PATH 给子进程。
3. **Windows .cmd shim 处理**：Node.js 生态的 Agent 在 Windows 上是 `.cmd` 脚本，不能直接 spawn，需要解析静默调用 Node 的对应脚本。
4. **Shell 环境传播**：GUI 启动的应用默认不继承终端环境，需通过登录 shell 获取认证密钥等。
5. **scoped event name 必做**：前端使用 UUID 作用域事件名，防止并发 Agent 流的 WebSocket 事件冲突。
6. **tilde 路径展开必做**：`~` 路径需在进入 Rust 前展开为绝对路径。
7. **超时必设**：Agent 可能卡住，`tokio::time::timeout` 或前端 `AbortController` 需要双向配合。
8. **文件操作的安全性**：Agent 的写入必须限制在项目目录内，Tolaria 使用 `boundary.rs` 做路径逃逸防护。
9. **日志与可观测性**：每个 Adapter 需要输出结构化日志（Session ID、Agent ID、事件类型）以便排查问题。

---

## 12 扩展点

如果需要从 Tolaria 风格的编排升级为 Agent 间协作（A2A），可以考虑：

1. 在编排层增加 **Agent Registry + Task Router**，允许多个 Agent 并行或串行执行
2. 实现 **Context Pass-through**：Agent A 的执行结果作为 Agent B 的输入
3. 增加 **Tool Delegation**：宿主应用暴露统一的 Tool Gateway，所有 Agent 共用同一组工具接口
4. 支持 **Agent 之间直接通信**（如官方 A2A 协议），但保留编排层作为安全边界

---

## 13 附录：完整文件清单

### `agent-integration-reference/` 目录结构（已按实际代码更新）

```
agent-integration-reference/
├── PRACTICE_PLAN.md        # 本文件
├── core-frontend/          # 前端 Agent 核心 TS 文件
│   ├── aiAgents.ts                       # Agent 注册表
│   ├── aiTargets.ts                      # Agent / Model 目标系统
│   ├── aiAgentSession.ts                 # 会话生命周期
│   ├── aiAgentStreamCallbacks.ts         # 流事件回调
│   ├── aiAgentFileOperations.ts          # Agent 文件操作检测
│   ├── aiAgentPermissionMode.ts          # 安全模式定义
│   ├── streamAiAgent.ts                  # Tauri IPC 调用
│   ├── aiStreamEvents.ts                 # 流事件 UUID 作用域
│   ├── ai-agent.ts                       # System Prompt 构建
│   ├── ai-chat.ts                        # 历史消息格式化 + token 截断
│   ├── ai-reference-content.ts           # Reference content utilities
│   ├── aiProviderSecrets.ts              # API key management
│   ├── useCliAiAgent.ts                  # 核心 orchestrator hook
│   ├── useAiAgentsStatus.ts              # Agent 状态轮询 hook
│   ├── useAiAgentsOnboarding.ts          # onboarding hook
│   ├── useAiAgentPreferences.ts          # 偏好管理 hook
│   └── useAppPreferences.ts              # 全局设置 hook
├── frontend-components/    # 前端 React 组件
│   ├── AiPanel.tsx                        # 主聊天面板
│   ├── AiMessage.tsx                      # 消息渲染
│   ├── AiActionCard.tsx                   # Tool 调用卡片
│   ├── AiAgentIcon.tsx                    # Agent 图标映射
│   ├── AiAgentsOnboardingPrompt.tsx       # 首次引导
│   ├── AiWorkspace.tsx                    # 多窗口工作台
│   ├── AiWorkspaceChrome.tsx              # Workspace 顶栏
│   ├── AiWorkspaceSidebar.tsx             # Workspace 侧栏
│   ├── AiWorkspaceWindowApp.tsx           # 独立窗口
│   ├── AiPanelChrome.tsx                  # Agent + 权限选择器
│   └── useAiPanelController.ts            # 面板控制器
├── backend-adapters/       # Rust Backend Adapter（扁平结构）
│   ├── ai_agents.rs                      # 中央编排器 + 事件归一化
│   ├── cli_agent_runtime.rs              # 共享 spawn + JSON stream 框架
│   ├── claude_cli.rs                     # Claude Code Adapter
│   ├── claude_invocation.rs              # Claude CLI 参数构造
│   ├── codex_cli.rs                      # Codex CLI Adapter
│   ├── opencode_cli.rs                   # OpenCode CLI Adapter
│   ├── opencode_config.rs                # OpenCode 配置生成
│   ├── opencode_discovery.rs             # OpenCode 二进制发现
│   ├── opencode_events.rs                # OpenCode JSON 事件解析
│   ├── pi_cli.rs                         # Pi CLI Adapter
│   ├── pi_config.rs                      # Pi 配置生成
│   ├── pi_discovery.rs                   # Pi 二进制发现
│   ├── pi_events.rs                      # Pi 事件解析
│   ├── gemini_cli.rs                     # Gemini CLI Adapter
│   ├── gemini_config.rs                  # Gemini 配置生成
│   ├── gemini_discovery.rs               # Gemini 二进制发现
│   ├── kiro_cli.rs                       # Kiro CLI Adapter
│   ├── kiro_discovery.rs                 # Kiro 二进制发现
│   ├── commands_ai.rs                    # Tauri IPC 命令绑定
│   ├── opencode_events_tests.rs          # OpenCode 事件解析测试
│   └── [opencode|gemini]_events_tests.rs  # 其他 Agent 事件测试（如存在）
└── mcp-server-baseline/    # MCP Server 参考实现
    ├── index.js                          # MCP Server Node.js 入口
    ├── tool-service.js                   # Tool 实现
    ├── ws-bridge.js                      # WebSocket bridge
    ├── vault.js                          # Vault 上下文
    ├── vault-path.js                     # 路径工具
    ├── agent-instructions.js             # Agent 指令生成
    ├── mcp.rs                            # MCP Server Rust 入口 + Tool 实现
    ├── paths.rs                          # 配置路径解析
    ├── subprocess.rs                     # MCP 子进程管理
    ├── opencode.rs                       # OpenCode MCP 格式
    ├── extraction.rs                     # Linux AppImage 资源提取
    └── package.json                      # Node 依赖声明
```