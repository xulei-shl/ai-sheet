# AI-Sheet 现代桌面端升级方案

> 从 Python Tkinter → Tauri 2.0 + React + pi-agent + Rust

---

## 一、升级目标

| 维度 | 现状 | 目标 |
|------|------|------|
| UI框架 | Tkinter + ttk | React + Ant Design + Tailwind CSS |
| LLM 交互 | 单轮调用，openai SDK | pi-agent 多轮对话 + 流式输出 + 工具调用 |
| 后端运行时 | Python 主进程 | Rust (Tauri Core) + Node.js (pi-agent Sidecar) |
| 安装包体积 | 无打包，需Python环境 | ~20-30MB 安装包（含 Node.js 运行时） |
| 内存占用 | Python进程 ~150MB+ | Rust ~20MB + Node.js ~60MB |
| 启动速度 | 3-5秒 | <2秒 |
| 视觉体验 | Windows 98风格 | 三栏现代桌面端布局 |
| 跨平台 | 仅Windows | Windows + macOS |
| 安全性 | API Key明文，无沙箱 | Keychain加密存储，pi-agent 工具隔离 |
| 分发方式 | 源码分发 | 安装包 + 自动更新 |

---

## 二、目标技术栈

### 2.1 技术选型明细

| 层次 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **桌面框架** | Tauri | 2.x | 应用壳、IPC、系统API |
| **前端框架** | React | 19.x | UI渲染 |
| **前端构建** | Vite | 6.x | 开发服务器 + 打包 |
| **UI组件库** | Ant Design | 5.x | 企业级组件 |
| **状态管理** | Zustand | 5.x | 轻量全局状态 |
| **样式方案** | Tailwind CSS | 4.x | 原子化CSS + 暗色主题 |
| **图标** | Lucide React | latest | 统一图标库 |
| **AI Agent** | pi-agent (SDK) | 0.78+ | 多轮对话、工具调用、流式输出、上下文压缩 |
| **LLM 提供者** | pi-ai providers | latest | Anthropic/OpenAI/DeepSeek/Google 等 9 类 API |
| **后端语言** | Rust | stable | Tauri Commands、Excel、数据库、安全存储 |
| **Excel处理** | calamine + rust_xlsxwriter | latest | 读写Excel（纯Rust） |
| **数据库** | SQLite (rusqlite) | 0.32 | 配置/提示词持久化 |
| **安全存储** | tauri-plugin-store | 2.x | API Key加密存储 |
| **自动更新** | tauri-plugin-updater | 2.x | 应用自动更新 |
| **文件系统** | tauri-plugin-fs / tauri-plugin-dialog | 2.x | 文件选择与读写 |
| **Sidecar 运行时** | Node.js / Bun | 20.x / latest | pi-agent SDK 运行环境 |

### 2.2 为什么用 pi-agent 替代自研 LLM 服务

| 能力 | 自研实现 | pi-agent |
|------|---------|----------|
| 多轮对话 | 需自建会话管理、消息持久化 | AgentSession + SessionManager 内置 |
| 流式输出 | 需自研 SSE 解析 + Tauri Events 桥接 | EventStream 内置，push-based async iterable |
| 工具调用 | 需自研工具调度框架 | AgentTool + Agent Loop 内置 |
| 上下文压缩 | 需自研滑动窗口 + LLM 摘要 | Auto-Compaction（token 阈值、迭代摘要、分片压缩） |
| 会话持久化 | 需自建 SQLite 表 | JSONL 树状持久化 + 分支支持 |
| Python 代码执行 | 需独立 Python Sidecar + JSON-RPC | bash 工具直接执行，Agent Loop 自动修复 |
| 重试/错误处理 | 需手写 | 内置指数退避 + Provider 级别重试 |
| 多 Provider 支持 | 仅 OpenAI 兼容 | 9 类 API（Anthropic/OpenAI/Google/Bedrock 等） |

**核心收益**：消除约 12 人天的 LLM 服务层开发量，同时获得远超自研的能力（无限多轮、智能压缩、分支对话）。

---

## 三、整体架构

### 3.1 三进程架构

```
┌───────────────────────────────────────────────────────────────┐
│                     Tauri 2.0 Application                      │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                React Frontend (WebView)                   │  │
│  │                                                          │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │  │
│  │  │ 左栏      │  │ 中栏          │  │ 右栏               │  │  │
│  │  │ Tab 导航  │  │ 数据窗口      │  │ AI Agent 对话      │  │  │
│  │  │          │  │ (Excel/表单)  │  │ (pi-agent 驱动)    │  │  │
│  │  └──────────┘  └──────────────┘  └────────┬──────────┘  │  │
│  │                                                 │        │  │
│  │              Tauri IPC / Events                          │  │
│  └────────────────────────────────┬─────────────────────────┘  │
│                                   │                            │
│  ┌────────────────────────────────▼─────────────────────────┐  │
│  │              Rust Backend (Tauri Core)                    │  │
│  │                                                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ Sidecar Mgr  │  │ Event Bridge │  │ HTTP Bridge  │   │  │
│  │  │ (进程管理)    │  │ (事件桥接)    │  │ (localhost)  │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │  │
│  │         │                  │                  │            │  │
│  │  ┌──────▼──────────────────▼──────────────────▼───────┐  │  │
│  │  │              Business Services                      │  │  │
│  │  │  Config | Prompt | Excel(calamine) | SQLite | Store │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────┬──────────────────────────────┘  │
│                              │ stdin/stdout JSONL               │
│  ┌───────────────────────────▼──────────────────────────────┐  │
│  │           Node.js Sidecar (pi-agent SDK)                  │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  AgentSession                                      │  │  │
│  │  │  ├── LLM Calls (all providers via pi-ai)          │  │  │
│  │  │  ├── Multi-turn Conversation (auto-compaction)    │  │  │
│  │  │  ├── Custom Tools ←──HTTP──→ Rust Backend         │  │  │
│  │  │  │   ├── read_excel    ──→ Rust Excel Service     │  │  │
│  │  │  │   ├── write_excel   ──→ Rust Excel Service     │  │  │
│  │  │  │   ├── apply_formula ──→ Rust Excel Service     │  │  │
│  │  │  │   ├── save_prompt   ──→ Rust Prompt Service    │  │  │
│  │  │  │   └── start_batch  ──→ Rust Batch Service      │  │  │
│  │  │  ├── bash (built-in) ──→ System Python            │  │  │
│  │  │  └── Session Persistence (JSONL)                   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Batch Runner (独立模块，复用 pi-ai Provider)       │  │  │
│  │  │  └── 逐行调用 LLM + 进度上报                       │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 三栏布局

```
┌──────────────────────────────────────────────────────────────────┐
│ ┌────────┐ ┌────────────────────────┐ ┌──────────────────────┐ │
│ │        │ │                        │ │                      │ │
│ │  📊    │ │                        │ │  🤖 AI-Sheet Agent   │ │
│ │ 数据   │ │    数据窗口             │ │                      │ │
│ │        │ │    (Excel/表单/预览)    │ │  [对话消息列表]       │ │
│ │  🧮    │ │                        │ │  用户: 统计销售额     │ │
│ │ 公式   │ │                        │ │  Agent: =SUMIF(...)   │ │
│ │        │ │                        │ │  用户: 改用Sheet2     │ │
│ │  🤖    │ │                        │ │  Agent: 已修改...     │ │
│ │ 模型   │ │                        │ │                      │ │
│ │        │ │                        │ │  ▋ (流式输出中)       │ │
│ │  🐍    │ │                        │ │                      │ │
│ │ 代码   │ │                        │ ├──────────────────────┤ │
│ │        │ │                        │ │ [输入框] [发送] [停止]│ │
│ │ ────── │ │                        │ │                      │ │
│ │  ⚙️    │ │                        │ │ 工具: read_excel     │ │
│ │ 配置   │ │                        │ │ 工具: apply_formula  │ │
│ │        │ │                        │ │                      │ │
│ │  📝    │ │                        │ │                      │ │
│ │ 提示词 │ │                        │ │                      │ │
│ └────────┘ └────────────────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**关键设计原则**：

| 原则 | 说明 |
|------|------|
| 右栏持久化 | 切换 Tab 不关闭对话，上下文连续 |
| 上下文自动注入 | 切换 Tab 时通过 steering message 告知 Agent 当前数据状态 |
| 工具对用户可见 | Agent 调用工具时在对话流中展示工具调用卡片 |
| 中右联动 | Agent 操作结果（写 Excel、应用公式）实时反映到中栏 |

### 3.3 通信架构

```
数据流向：

1. 用户发送消息（右栏）
   React → Tauri IPC → Rust → stdin JSONL → Node.js (pi-agent)

2. Agent 流式响应
   Node.js → stdout JSONL → Rust (Event Bridge) → Tauri Events → React

3. Agent 调用自定义工具
   Node.js (pi-agent tool.execute()) → HTTP → Rust (HTTP Bridge) → Service → HTTP Response → Node.js

4. Agent 执行 Python 代码
   Node.js (bash tool) → 系统进程 → stdout/stderr → pi-agent 自动捕获

5. 中栏数据变更通知 Agent
   React → Tauri IPC → Rust → stdin JSONL (steering message) → Node.js (session.steer())

6. Agent 操作结果更新中栏
   Node.js (tool 执行完成) → stdout event → Rust → Tauri Events → React (刷新数据)
```

### 3.4 双模式设计原则

每个核心功能同时支持**直接执行**和**Agent 辅助**两种模式：

| 模式 | 触发方式 | 适用场景 | 实现位置 |
|------|---------|---------|---------|
| **直接执行** | 中栏页面表单操作 | 提示词/公式已知，重复性批量任务 | 中栏页面 + Rust Tauri Commands → Sidecar |
| **Agent 辅助** | 右栏对话 | 首次生成、迭代优化、复杂需求 | 右栏 AgentChatPanel + pi-agent |

**核心原则**：Agent 是"生成器"（首次创作、迭代优化），中栏页面是"执行器"（复用已有配置、批量跑任务）。两者共享同一套 Rust 数据服务和 pi-ai Provider，只是触发路径不同。

两种模式可联动：
- 用户在右栏让 Agent 生成提示词 → 保存后中栏下拉可选
- 用户在右栏让 Agent 生成公式 → 确认后自动填入中栏
- 用户在中栏执行批量处理 → 进度事件同时推送至右栏 Agent 可见
- 批量处理出错 → 用户向 Agent 提问，Agent 通过工具了解上下文

### 3.5 导航分组

| 分组 | 页面 | 路由 | 直接执行能力 | 右栏 Agent 角色 |
|------|------|------|-------------|----------------|
| 数据 | Excel 上传 | `/data/upload` | — | 可查看数据、建议列选择 |
| 数据 | 公式生成 | `/data/formula-gen` | — | 多轮对话生成公式 |
| 数据 | 公式处理 | `/data/formula-proc` | ✅ 选择Sheet/列 + 输入公式 → 直接执行 | 监控公式应用、调整公式 |
| AI | 提示词生成 | `/ai/prompt-gen` | — | 多轮对话优化提示词 |
| AI | 大模型处理 | `/ai/llm-batch` | ✅ 选择Sheet/列 + 选择已保存提示词 → 直接执行 | 配置批量任务、监控进度 |
| AI | Python 处理 | `/ai/python` | — | 生成/执行/修复代码 |
| 管理 | 配置管理 | `/admin/config` | — | 可辅助配置和测试连接 |
| 管理 | 提示词管理 | `/admin/prompts` | — | 可辅助编辑和优化提示词 |

---

## 四、项目结构设计

```
ai-sheet-v2/
├── src-tauri/                          # Rust 后端 (Tauri Core)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs                      # Tauri setup + 命令注册 + Sidecar 启动
│       ├── error.rs
│       │
│       ├── commands/                   # Tauri IPC 命令层
│       │   ├── mod.rs
│       │   ├── config.rs              # 配置 CRUD
│       │   ├── prompt.rs              # 提示词 CRUD
│       │   ├── excel.rs               # Excel 读写操作
│       │   ├── batch.rs               # 批量处理直接执行（绕过 Agent）
│       │   └── sidecar.rs             # Agent 通信桥接
│       │
│       ├── services/
│       │   ├── mod.rs
│       │   ├── config_service.rs      # 配置管理
│       │   ├── prompt_service.rs      # 提示词管理
│       │   ├── excel_service.rs       # Excel 读写 (calamine + rust_xlsxwriter)
│       │   ├── batch_service.rs       # 批量处理管理（状态追踪、暂停/续传）
│       │   ├── sidecar_manager.rs     # Node.js Sidecar 进程管理
│       │   └── bridge_server.rs       # HTTP Bridge Server (localhost)
│       │
│       ├── models/
│       │   ├── mod.rs
│       │   ├── config.rs
│       │   ├── prompt.rs
│       │   └── excel.rs
│       │
│       └── db/
│           ├── mod.rs
│           ├── connection.rs
│           └── migrations/
│               ├── 001_initial.rs
│               └── 002_prompts.rs
│
├── src-agent/                          # Node.js Sidecar (pi-agent)
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsup.config.ts                  # Build config → 单文件可执行
│   └── src/
│       ├── main.ts                     # Sidecar 入口：启动 AgentSession，监听 stdin
│       ├── agent.ts                    # AgentSession 创建、工具注册、事件订阅
│       ├── bridge.ts                   # HTTP client → Rust Bridge Server
│       ├── tools/                      # pi-agent 自定义工具
│       │   ├── mod.ts
│       │   ├── excel-tools.ts          # read_excel, write_excel, apply_formula
│       │   ├── config-tools.ts         # get_config, test_connection
│       │   ├── prompt-tools.ts         # get_prompts, save_prompt, list_prompts
│       │   └── batch-tools.ts          # start_batch, pause_batch, get_batch_status
│       ├── prompts/                    # 系统提示词模板
│       │   ├── system.ts               # AI-Sheet 通用 system prompt
│       │   └── contexts.ts             # 功能上下文模板（公式/代码/提示词等）
│       └── batch/                      # 批量处理模块（复用 pi-ai Provider）
│           ├── runner.ts               # 批量处理运行器
│           └── progress.ts             # 进度上报
│
├── src/                                # React 前端
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── layouts/
│   │   └── AppLayout.tsx              # 三栏布局（左Tab + 中数据 + 右Agent）
│   │
│   ├── pages/                          # 中栏内容页面
│   │   ├── ExcelUpload/
│   │   │   ├── index.tsx
│   │   │   ├── ExcelSelector.tsx
│   │   │   ├── SheetSelector.tsx
│   │   │   ├── ColumnSelector.tsx
│   │   │   └── DataPreview.tsx
│   │   ├── FormulaGeneration/
│   │   │   ├── index.tsx
│   │   │   └── FormulaResult.tsx
│   │   ├── FormulaProcessing/
│   │   │   ├── index.tsx
│   │   │   ├── FormulaInput.tsx       # 公式直接输入 + 历史加载
│   │   │   ├── FormulaPreview.tsx     # 公式预览（前3行结果）
│   │   │   └── BatchProgress.tsx
│   │   ├── PromptGeneration/
│   │   │   └── index.tsx
│   │   ├── LLMProcessing/
│   │   │   ├── index.tsx
│   │   │   ├── PromptSelector.tsx     # 已保存提示词选择 + 自定义输入
│   │   │   ├── ModelParamsForm.tsx    # 模型选择 + 温度等参数
│   │   │   ├── ProgressTracker.tsx
│   │   │   └── BatchLogPanel.tsx      # 逐行处理日志
│   │   ├── PythonProcessing/
│   │   │   ├── index.tsx
│   │   │   └── ExecutionResult.tsx
│   │   ├── ConfigManagement/
│   │   │   ├── index.tsx
│   │   │   └── ModelForm.tsx
│   │   └── PromptManagement/
│   │       ├── index.tsx
│   │       └── PromptEditor.tsx
│   │
│   ├── components/
│   │   ├── ui/                        # 基础 UI（Ant Design 封装）
│   │   ├── agent/                     # AI Agent 对话组件
│   │   │   ├── AgentChatPanel.tsx     # 右栏主面板
│   │   │   ├── MessageList.tsx        # 消息列表
│   │   │   ├── MessageBubble.tsx      # 消息气泡
│   │   │   ├── StreamingContent.tsx   # 流式文本渲染
│   │   │   ├── CodeBlock.tsx          # 代码块（语法高亮）
│   │   │   ├── ToolCallCard.tsx       # 工具调用展示
│   │   │   └── AgentInput.tsx         # 输入框
│   │   ├── excel/
│   │   │   ├── FileDropZone.tsx
│   │   │   ├── ExcelTable.tsx
│   │   │   └── ColumnSelector.tsx
│   │   └── common/
│   │       ├── MarkdownRenderer.tsx
│   │       └── ThemeToggle.tsx
│   │
│   ├── stores/
│   │   ├── configStore.ts            # 配置状态
│   │   ├── promptStore.ts            # 提示词状态
│   │   ├── excelStore.ts             # Excel 数据状态
│   │   ├── processingStore.ts        # 处理进度状态
│   │   ├── agentStore.ts             # Agent 对话状态（桥接 pi-agent）
│   │   └── uiStore.ts                # UI 状态（主题、侧边栏、当前 Tab）
│   │
│   ├── hooks/
│   │   ├── useAgentChat.ts           # Agent 对话交互
│   │   ├── useStreamingText.ts       # 流式文本渲染
│   │   └── useFileDrop.ts
│   │
│   ├── services/
│   │   ├── tauri.ts                  # Tauri API 封装
│   │   └── events.ts                 # 事件定义
│   │
│   ├── types/
│   │   ├── config.ts
│   │   ├── prompt.ts
│   │   ├── excel.ts
│   │   ├── processing.ts
│   │   └── agent.ts                  # Agent 消息/事件类型
│   │
│   └── styles/
│       ├── globals.css
│       └── themes/
│
├── public/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## 五、Rust 后端设计

### 5.1 Tauri IPC 命令

Rust 后端专注于**桌面能力**和**数据服务**，不涉及 LLM 调用。

```rust
// commands/config.rs — 配置管理
#[tauri::command] async fn get_all_models() -> Result<Vec<ModelConfig>, AppError>
#[tauri::command] async fn add_model(config: ModelConfig) -> Result<(), AppError>
#[tauri::command] async fn update_model(index: usize, config: ModelConfig) -> Result<(), AppError>
#[tauri::command] async fn delete_model(index: usize) -> Result<(), AppError>
#[tauri::command] async fn set_default_model(index: usize) -> Result<(), AppError>
#[tauri::command] async fn test_api_connection(config: ModelConfig) -> Result<ConnectionTestResult, AppError>
#[tauri::command] async fn export_config(path: String) -> Result<(), AppError>
#[tauri::command] async fn import_config(path: String) -> Result<(), AppError>

// commands/prompt.rs — 提示词管理
#[tauri::command] async fn get_all_prompts() -> Result<Vec<Prompt>, AppError>
#[tauri::command] async fn save_prompt(prompt: PromptInput) -> Result<Prompt, AppError>
#[tauri::command] async fn delete_prompt(id: String) -> Result<(), AppError>

// commands/excel.rs — Excel 读写
#[tauri::command] async fn get_excel_info(path: String) -> Result<ExcelInfo, AppError>
#[tauri::command] async fn get_sheet_names(path: String) -> Result<Vec<String>, AppError>
#[tauri::command] async fn get_column_names(path: String, sheet: String) -> Result<Vec<String>, AppError>
#[tauri::command] async fn get_column_data(path: String, sheet: String, columns: Vec<String>) -> Result<ColumnDataSet, AppError>
#[tauri::command] async fn get_sample_data(path: String, sheet: String, rows: usize) -> Result<SampleData, AppError>
#[tauri::command] async fn get_processing_status(path: String, sheet: String, result_column: String) -> Result<ProcessingStatus, AppError>
#[tauri::command] async fn write_results(path: String, sheet: String, results: Vec<WriteResult>) -> Result<(), AppError>
#[tauri::command] async fn apply_formula(path: String, sheet: String, column: String, formula: String) -> Result<(), AppError>

// commands/sidecar.rs — Agent 通信桥接
#[tauri::command] async fn send_agent_message(content: String) -> Result<(), AppError>
#[tauri::command] async fn steer_agent(context: String) -> Result<(), AppError>
#[tauri::command] async fn stop_agent_stream() -> Result<(), AppError>
#[tauri::command] async fn get_agent_status() -> Result<AgentStatus, AppError>

// commands/batch.rs — 批量处理直接执行（不经过 Agent Loop）
#[tauri::command] async fn start_batch_processing(
    file_path: String,
    sheet: String,
    input_columns: Vec<String>,
    output_column: String,
    prompt_id: Option<String>,      // 选择已保存提示词
    custom_prompt: Option<String>,  // 或自定义提示词
    model_index: Option<usize>,
    temperature: f64,
) -> Result<String, AppError>  // 返回 batch_id
#[tauri::command] async fn pause_batch(batch_id: String) -> Result<(), AppError>
#[tauri::command] async fn resume_batch(batch_id: String) -> Result<(), AppError>
#[tauri::command] async fn stop_batch(batch_id: String) -> Result<(), AppError>
#[tauri::command] async fn get_batch_status(batch_id: String) -> Result<BatchStatus, AppError>
```

### 5.2 HTTP Bridge Server

Node.js Sidecar 通过 HTTP 调用 Rust 后端的服务能力：

```
POST /api/excel/info          → excel_service.get_info()
POST /api/excel/columns       → excel_service.get_column_data()
POST /api/excel/sample        → excel_service.get_sample_data()
POST /api/excel/write         → excel_service.write_results()
POST /api/excel/apply-formula → excel_service.apply_formula()
POST /api/excel/processing-status → excel_service.get_processing_status()

POST /api/batch/start         → batch_service.start() (向 Sidecar 发送 batch_start 命令)
POST /api/batch/pause         → batch_service.pause()
POST /api/batch/resume        → batch_service.resume()
POST /api/batch/stop          → batch_service.stop()
GET  /api/batch/status/:id    → batch_service.get_status()

GET  /api/config/models       → config_service.get_all_models()
GET  /api/config/default      → config_service.get_default_model()
POST /api/config/test         → config_service.test_connection()

GET  /api/prompts             → prompt_service.get_all_prompts()
POST /api/prompts             → prompt_service.save_prompt()
POST /api/prompts/test        → prompt_service.validate_prompt()
```

**安全措施**：HTTP Bridge 仅监听 `localhost`，端口动态分配，启动时通过命令行参数传递给 Node.js Sidecar。

### 5.3 Sidecar 进程管理

```rust
// services/sidecar_manager.rs
pub struct SidecarManager {
    process: Option<Child>,
    bridge_port: u16,
    stdout_reader: Option<JoinHandle<()>>,
}

impl SidecarManager {
    /// 启动 Node.js Sidecar
    /// 1. 分配可用端口启动 HTTP Bridge
    /// 2. 启动 node 进程，传入 --bridge-port 参数
    /// 3. 启动 stdout 读取线程，解析 JSONL 事件
    /// 4. 通过 app.emit() 转发到 React
    pub async fn start(&mut self, app: AppHandle) -> Result<(), AppError>;

    /// 发送消息到 Sidecar stdin
    pub async fn send_message(&self, message: &str) -> Result<(), AppError>;

    /// 发送 steering message（Tab 切换时更新上下文）
    pub async fn steer(&self, context: &str) -> Result<(), AppError>;

    /// 停止 Sidecar
    pub async fn stop(&mut self) -> Result<(), AppError>;
}
```

### 5.4 事件桥接

Node.js Sidecar 通过 stdout 输出 JSONL 事件，Rust 解析后通过 Tauri Events 转发：

| Sidecar stdout 事件 | Tauri Event | Payload | 用途 |
|---------------------|-------------|---------|------|
| `agent_text_delta` | `agent-stream-chunk` | `{ content, done }` | 流式文本片段 |
| `agent_text_done` | `agent-stream-done` | `{ content }` | 本轮回复完成 |
| `agent_tool_start` | `agent-tool-start` | `{ tool, args }` | 工具调用开始 |
| `agent_tool_end` | `agent-tool-end` | `{ tool, result }` | 工具调用完成 |
| `agent_turn_end` | `agent-turn-end` | `{ summary }` | 一轮对话结束 |
| `agent_error` | `agent-error` | `{ message }` | 错误 |
| `batch_progress` | `batch-progress` | `{ batchId, current, total, speed }` | 批量处理进度 |
| `batch_row_complete` | `batch-row-complete` | `{ batchId, row, result }` | 单行处理完成 |
| `batch_done` | `batch-done` | `{ batchId, stats }` | 批量处理完成 |
| `batch_paused` | `batch-paused` | `{ batchId }` | 批量处理暂停 |
| `batch_error` | `batch-error` | `{ batchId, message }` | 批量处理错误 |
| `sidecar_ready` | `sidecar-ready` | `{}` | Sidecar 启动完成 |

---

## 六、Node.js Agent 设计（pi-agent 集成）

### 6.1 AgentSession 创建

```typescript
// src-agent/agent.ts
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';
import { excelTools } from './tools/excel-tools';
import { configTools } from './tools/config-tools';
import { promptTools } from './tools/prompt-tools';
import { batchTools } from './tools/batch-tools';
import { buildSystemPrompt } from './prompts/system';

export async function createSheetAgent(bridgePort: number) {
  const bridge = new BridgeClient(bridgePort);

  // 从 Rust 获取默认模型配置
  const modelConfig = await bridge.getDefaultModel();
  const model = getModel(modelConfig.providerType, modelConfig.modelId);

  const { session } = await createAgentSession({
    model,
    systemPrompt: buildSystemPrompt(),
    tools: ['bash', 'read', 'write'],  // 内置工具
    customTools: [
      ...excelTools(bridge),
      ...configTools(bridge),
      ...promptTools(bridge),
      ...batchTools(bridge),
    ],
    sessionManager: SessionManager.inMemory(),  // 可选持久化到文件
    cwd: process.cwd(),
  });

  return session;
}
```

### 6.2 自定义工具定义

```typescript
// src-agent/tools/excel-tools.ts
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

export function excelTools(bridge: BridgeClient) {
  return [
    defineTool({
      name: 'read_excel',
      description: '读取 Excel 文件信息、Sheet 列表、列数据或样本数据',
      parameters: Type.Object({
        action: Type.Union([Type.Literal('info'), Type.Literal('columns'), Type.Literal('sample')]),
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.Optional(Type.String({ description: 'Sheet 名称' })),
        columns: Type.Optional(Type.Array(Type.String(), { description: '要读取的列名' })),
        rows: Type.Optional(Type.Number({ description: '样本行数' })),
      }),
      execute: async (_id, params) => {
        const result = await bridge.post(`/api/excel/${params.action}`, params);
        return { output: JSON.stringify(result), success: true };
      },
    }),

    defineTool({
      name: 'write_excel',
      description: '将处理结果写入 Excel 文件的指定列',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        results: Type.Array(Type.Object({
          row: Type.Number(),
          value: Type.String(),
        }), { description: '写入数据' }),
      }),
      execute: async (_id, params) => {
        await bridge.post('/api/excel/write', params);
        return { output: `已写入 ${params.results.length} 条结果`, success: true };
      },
    }),

    defineTool({
      name: 'apply_formula',
      description: '将 Excel 公式应用到指定列的所有行',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        column: Type.String({ description: '目标列名' }),
        formula: Type.String({ description: 'Excel 公式' }),
      }),
      execute: async (_id, params) => {
        await bridge.post('/api/excel/apply-formula', params);
        return { output: `公式 ${params.formula} 已应用到 ${params.column} 列`, success: true };
      },
    }),
  ];
}
```

### 6.3 系统提示词设计

```typescript
// src-agent/prompts/system.ts
export function buildSystemPrompt(context?: AgentContext): string {
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
${context ? `
- 当前功能：${context.currentTab}
- 已加载文件：${context.loadedFiles.join(', ') || '无'}
- 选中列：${context.selectedColumns.join(', ') || '无'}
- 样本数据预览：${context.sampleDataPreview || '无'}
` : '（暂无数据上下文，请先在左侧上传 Excel 文件）'}

## 注意事项
- 生成公式前先确认数据列和 Sheet 名称
- 执行 Python 代码前先检查依赖是否已安装
- 写入 Excel 前确认用户意图
- 批量处理大量数据时先在小样本上验证`;
}
```

### 6.4 上下文注入（Steering Messages）

当用户切换 Tab 或数据状态变更时，Rust 发送 steering message 更新 Agent 上下文：

```typescript
// src-agent/main.ts — steering message 处理
interface SteeringMessage {
  type: 'steer';
  context: {
    currentTab: string;
    loadedFiles: string[];
    selectedColumns: string[];
    sampleDataPreview?: string;
  };
}

// 收到 steering message 时，调用 session.steer()
function handleSteer(session: AgentSession, msg: SteeringMessage) {
  session.steer({
    role: 'user',
    content: `[系统上下文更新] 用户切换到了"${msg.context.currentTab}"功能。` +
      `当前文件：${msg.context.loadedFiles.join(', ')}` +
      `选中列：${msg.context.selectedColumns.join(', ')}`,
  }, { drainMode: 'all' });
}
```

### 6.5 批量处理模块

批量处理支持两种触发路径：**Agent 工具触发**和**中栏页面直接执行**。两者共用同一个 `BatchRunner`，区别在于触发入口和是否经过 Agent Loop。

#### 6.5.1 BatchRunner（共用核心）

批量处理不走 Agent Loop（避免每行的工具调度开销），而是复用 pi-ai 的 Provider 直接调用 LLM：

```typescript
// src-agent/batch/runner.ts
import { stream } from '@earendil-works/pi-ai';

export class BatchRunner {
  private abortController: AbortController | null = null;

  async run(params: BatchParams, onProgress: (p: BatchProgress) => void) {
    this.abortController = new AbortController();

    // 从 Rust 获取数据
    const data = await bridge.post('/api/excel/columns', {
      path: params.filePath,
      sheet: params.sheet,
      columns: params.inputColumns,
    });

    for (let i = 0; i < data.rows.length; i++) {
      if (this.abortController.signal.aborted) break;

      // 断点续传：跳过已处理行
      const status = await bridge.post('/api/excel/processing-status', { ... });
      if (status.processedRows.includes(i)) continue;

      // 直接用 pi-ai provider 调用 LLM
      const result = await stream({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: data.rows[i].combined },
        ],
      });

      const content = await result.text();

      // 写入结果
      await bridge.post('/api/excel/write', {
        path: params.filePath,
        sheet: params.sheet,
        results: [{ row: i, value: content }],
      });

      onProgress({ current: i + 1, total: data.rows.length });
    }
  }

  abort() {
    this.abortController?.abort();
  }
}
```

#### 6.5.2 直接执行路径（中栏页面触发）

用户在中栏 `/ai/llm-batch` 页面通过表单操作直接执行批量处理，无需通过 Agent 对话：

```
┌─────────────────────────────────────────┐
│  LLM 批量处理                            │
│                                         │
│  ① Excel文件: [已选择文件路径]  [更换]    │
│  ② Sheet:    [下拉选择]                  │
│  ③ 输入列:   [☑列A] [☑列B] [☐列C]      │
│  ④ 输出列:   [AI结果 ▼]                  │
│  ⑤ 提示词:   [下拉选择已保存提示词 ▼]     │
│              ── 或 ──                    │
│              [自定义输入提示词]            │
│  ⑥ 模型:     [默认模型 ▼]               │
│  ⑦ 温度:     [0.3 ──●── 1.0]            │
│                                         │
│  [▶ 开始处理]  [⏸ 暂停]  [⏹ 停止]       │
│                                         │
│  ── 进度 ──────────────────────────────  │
│  ████████████░░░░  75%  150/200 行       │
│  速度: 12.3 行/分钟  预计剩余: 4分钟      │
│                                         │
│  ── 日志 ──────────────────────────────  │
│  ✅ 第150行: "分析结果..."               │
│  ⏳ 第151行: 处理中...                   │
└─────────────────────────────────────────┘
```

**数据流**：React 表单 → Tauri IPC (`start_batch_processing`) → Rust → stdin JSONL (`batch_start`) → Node.js BatchRunner → stdout 事件 → Rust Event Bridge → Tauri Events → React（进度更新）

**提示词选择逻辑**：
1. 用户从下拉框选择已保存提示词 → Rust 查询 `prompts` 表 → 返回提示词内容
2. 用户自定义输入提示词 → 直接传递内容，不保存
3. 用户可选"保存当前提示词" → 调用 `save_prompt` 入库，下次可复用

#### 6.5.3 Agent 工具触发路径

Agent 通过 `start_batch` 工具触发批量处理，适用于 Agent 辅助生成提示词后直接执行：

```typescript
// src-agent/tools/batch-tools.ts — start_batch 工具
defineTool({
  name: 'start_batch',
  description: '对 Excel 数据批量调用 LLM 处理',
  parameters: Type.Object({
    path: Type.String(),
    sheet: Type.String(),
    inputColumns: Type.Array(Type.String()),
    outputColumn: Type.String(),
    prompt: Type.String({ description: '处理提示词' }),
    savePrompt: Type.Optional(Type.Boolean({ description: '是否保存提示词供复用' })),
    promptName: Type.Optional(Type.String({ description: '保存时的提示词名称' })),
  }),
  execute: async (_id, params) => {
    // 可选保存提示词
    if (params.savePrompt && params.promptName) {
      await bridge.post('/api/prompts', { name: params.promptName, content: params.prompt });
    }
    // 启动批量处理
    const { batchId } = await bridge.post('/api/batch/start', params);
    return { output: `批量处理已启动，ID: ${batchId}`, success: true };
  },
}),
```

#### 6.5.4 Sidecar 通信协议扩展

Sidecar stdin 消息类型扩展，支持直接执行命令：

```typescript
// src-agent/main.ts — 完整消息类型
type SidecarMessage =
  | { type: 'agent_message'; content: string }
  | { type: 'steer'; context: AgentContext }
  // 直接执行命令（中栏页面触发，绕过 Agent Loop）
  | { type: 'batch_start'; params: BatchParams }
  | { type: 'batch_pause'; batchId: string }
  | { type: 'batch_resume'; batchId: string }
  | { type: 'batch_stop'; batchId: string }
  | { type: 'batch_status'; batchId: string }
```

### 6.6 公式直接应用

与批量处理类似，公式应用也支持双模式：

#### 6.6.1 直接执行路径（中栏页面触发）

用户在中栏 `/data/formula-proc` 页面直接输入公式并执行：

```
┌─────────────────────────────────────────┐
│  公式批量处理                            │
│                                         │
│  ① Excel文件: [已选择文件路径]  [更换]    │
│  ② Sheet:    [下拉选择]                  │
│  ③ 目标列:   [下拉选择]                  │
│  ④ 公式:     [输入框，如 =CONCAT(A2,B2)] │
│              ── 或 ──                    │
│              [从历史加载 ▼]               │
│  ⑤ 预览:     [预览前3行结果]             │
│                                         │
│  [▶ 应用公式]  [⏹ 停止]                  │
│                                         │
│  ── 进度 ──────────────────────────────  │
│  ████████████████░░  90%  900/1000 行    │
└─────────────────────────────────────────┘
```

**数据流**：React 表单 → Tauri IPC (`apply_formula`) → Rust `excel_service.apply_formula()` → Tauri Events → React（进度更新）。此路径完全在 Rust 侧完成，无需经过 Sidecar。

#### 6.6.2 Agent 辅助路径

用户在右栏对话中让 Agent 生成公式 → Agent 调用 `apply_formula` 工具执行。生成后公式自动记录到 `formula_cache` 表，中栏"从历史加载"可复用。

---

## 七、数据模型设计

### 7.1 SQLite 数据库 Schema（仅业务数据）

对话管理由 pi-agent 负责，SQLite 只存业务数据：

```sql
-- 模型配置表
CREATE TABLE models (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    api_key     TEXT NOT NULL,  -- 加密存储
    base_url    TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'openai-completions',  -- pi-ai provider type
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 提示词表
CREATE TABLE prompts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    content     TEXT NOT NULL,
    category    TEXT,
    is_system   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 公式缓存表
CREATE TABLE formula_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement TEXT NOT NULL,
    columns_key TEXT NOT NULL,
    formula     TEXT NOT NULL,
    explanation TEXT,
    model_id    TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- 应用设置表
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

**与原方案的关键差异**：去掉了 `conversations` 和 `conversation_messages` 表，对话持久化由 pi-agent 的 SessionManager（JSONL 文件）负责。

### 7.2 pi-agent 会话持久化

pi-agent 使用 JSONL 树状结构持久化对话，支持分支和回溯：

```
~/.ai-sheet/sessions/
├── <session-id>.jsonl     # 完整对话历史（支持分支导航）
└── ...
```

每行一个 JSON 条目，通过 `id`/`parentId` 形成树结构。自动压缩（Compaction）在 context 溢出时触发。

### 7.3 Rust 数据结构

```rust
// models/config.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelConfig {
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    pub provider_type: String,  // "anthropic-messages" / "openai-completions" / etc.
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

// models/excel.rs
#[derive(Debug, Serialize, Deserialize)]
pub struct ExcelInfo {
    pub file_path: String,
    pub file_size: u64,
    pub sheet_count: usize,
    pub sheet_names: Vec<String>,
    pub row_count: usize,
    pub column_count: usize,
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnData {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
    pub combined: Vec<String>,
    pub total_rows: usize,
}

// models/prompt.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub category: PromptCategory,
    pub is_system: bool,
    pub created_at: String,
    pub updated_at: String,
}
```

### 7.4 TypeScript 类型定义

```typescript
// types/agent.ts
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: string;
  isStreaming?: boolean;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface AgentContext {
  currentTab: string;
  loadedFiles: string[];
  selectedColumns: string[];
  sampleDataPreview?: string;
}

export interface AgentStatus {
  ready: boolean;
  sessionId: string | null;
  isStreaming: boolean;
}
```

---

## 八、前端架构设计

### 8.1 状态管理（Zustand）

```typescript
// stores/agentStore.ts — AI Agent 对话状态
interface AgentStore {
  // State
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingContent: string;
  currentToolCalls: ToolCall[];
  isReady: boolean;
  error: string | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearConversation: () => void;

  // 内部：Tauri Events 处理
  _handleStreamChunk: (chunk: StreamChunk) => void;
  _handleStreamDone: (content: string) => void;
  _handleToolStart: (call: ToolCall) => void;
  _handleToolEnd: (result: ToolResult) => void;
  _handleError: (error: string) => void;

  // 事件订阅
  subscribeToEvents: () => () => void;
}

// stores/excelStore.ts — Excel 数据状态
interface ExcelStore {
  files: ExcelFileInfo[];
  selections: MultiExcelSelection[];
  previewData: string;
  columnList: string[];
  sampleData: string;

  addFile: (path: string) => Promise<void>;
  removeFile: (index: number) => void;
  selectSheets: (fileIndex: number, sheets: string[]) => void;
  selectColumns: (fileIndex: number, sheet: string, columns: string[]) => void;
  loadPreview: () => Promise<void>;

  // 数据变更时通知 Agent
  notifyContextChange: () => void;
}

// stores/processingStore.ts — 处理进度
interface ProcessingStore {
  batchStatus: ProcessingStatus;
  batchProgress: BatchProgress;
  batchLogs: BatchLog[];
  // 直接执行模式状态
  isBatchRunning: boolean;
  selectedPromptId: string | null;
  customPrompt: string;
  modelParams: { modelIndex: number; temperature: number };
  startBatch: (params: BatchStartParams) => Promise<void>;
  pauseBatch: () => Promise<void>;
  resumeBatch: () => Promise<void>;
  stopBatch: () => Promise<void>;
  subscribeToEvents: () => () => void;
}

// stores/configStore.ts — 配置状态（不变）
// stores/promptStore.ts — 提示词状态（不变）
// stores/uiStore.ts — UI 状态（主题、当前 Tab、面板尺寸）
```

### 8.2 核心组件

```tsx
// layouts/AppLayout.tsx — 三栏布局
function AppLayout() {
  return (
    <div className="flex h-screen">
      {/* 左栏：Tab 导航 */}
      <nav className="w-16 flex flex-col items-center py-4 border-r">
        {tabs.map(tab => (
          <TabButton key={tab.route} icon={tab.icon} route={tab.route} />
        ))}
      </nav>

      {/* 中栏：数据窗口 */}
      <main className="flex-1 overflow-auto">
        <Outlet /> {/* React Router 渲染当前 Tab 页面 */}
      </main>

      {/* 右栏：AI Agent 对话 */}
      <aside className="w-96 border-l flex flex-col">
        <AgentChatPanel />
      </aside>
    </div>
  );
}
```

### 8.3 AgentChatPanel 组件

```tsx
// components/agent/AgentChatPanel.tsx
function AgentChatPanel() {
  const { messages, isStreaming, streamingContent, sendMessage, stopStreaming } = useAgentStore();

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="p-3 border-b flex items-center justify-between">
        <span className="font-medium">AI-Sheet Agent</span>
        <Button size="small" onClick={clearConversation}>新对话</Button>
      </div>

      {/* 消息列表 */}
      <MessageList className="flex-1 overflow-auto">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && (
          <StreamingContent content={streamingContent} />
        )}
      </MessageList>

      {/* 工具调用展示（折叠卡片） */}
      {/* 已嵌入 MessageBubble 中 */}

      {/* 输入区 */}
      <AgentInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
      />
    </div>
  );
}
```

### 8.4 数据- Agent 联动

当用户在中栏操作数据时，自动通知 Agent：

```typescript
// stores/excelStore.ts 中的联动逻辑
addFile: async (path: string) => {
  // ... 原有逻辑
  get().notifyContextChange();
},

selectColumns: (fileIndex: number, sheet: string, columns: string[]) => {
  // ... 原有逻辑
  get().notifyContextChange();
},

notifyContextChange: () => {
  const state = get();
  const context: AgentContext = {
    currentTab: uiStore.getState().currentTab,
    loadedFiles: state.files.map(f => f.path),
    selectedColumns: state.selections.flatMap(s => s.columns),
  };
  invoke('steer_agent', { context });
},
```

---

## 九、核心模块迁移对照表

### 9.1 整体迁移策略

| 原Python模块 | 新实现 | 迁移策略 | 工作量 |
|-------------|--------|---------|--------|
| `units/llm_client.py` (420行) | **pi-agent** (替换) | 删除自研，pi-ai Provider 内置 | 0 |
| `modules/config_manager.py` (484行) | `services/config_service.rs` | 逻辑移植，JSON→SQLite，API Key加密 | 中 |
| `modules/prompt_manager.py` | `services/prompt_service.rs` | 逻辑移植，JSON→SQLite | 低 |
| `modules/excel_processor.py` (306行) | `services/excel_service.rs` | openpyxl→calamine/rust_xlsxwriter重写 | 中 |
| `modules/formula_generator.py` | **pi-agent + 自定义 Tool** | 公式生成逻辑由 Agent 对话驱动 | 低 |
| `modules/llm_batch_processor.py` | `src-agent/batch/runner.ts` | 逻辑移植到 Node.js，复用 pi-ai Provider | 中 |
| `modules/python_code_processor.py` | **pi-agent (bash tool)** | 删除自研编排器，Agent Loop 自动生成/执行/修复 | 0 |
| `modules/python_code_executor.py` | **pi-agent (bash tool)** | 删除自研执行器，bash 工具直接执行 | 0 |
| `modules/package_manager.py` | **pi-agent (bash tool)** | 删除自研，Agent 自主 pip install | 0 |
| `modules/multi_excel_utils.py` | 内联于 `excel_service.rs` | 逻辑合并 | 低 |
| `modules/prompt_generator.py` | **pi-agent 对话** | 提示词生成由 Agent 多轮对话驱动 | 0 |
| `modules/formula_processor.py` | `excel_service.apply_formula` | 公式应用逻辑移植到 Rust | 低 |

**关键变化**：6 个 Python 模块被 pi-agent 直接替代，迁移工作量大幅降低。

### 9.2 新增模块

| 新模块 | 说明 | 位置 |
|--------|------|------|
| `src-agent/` | Node.js Sidecar 全部代码 | 新增 |
| `sidecar_manager.rs` | Sidecar 进程生命周期管理 | Rust 新增 |
| `bridge_server.rs` | HTTP Bridge（Rust 侧） | Rust 新增 |
| `AgentChatPanel` 组件族 | 右栏 AI 对话 UI | React 新增 |
| `agentStore` | Agent 状态管理 | React 新增 |

---

## 十、安全设计

### 10.1 API Key 安全存储

- API Key 使用 `tauri-plugin-store` 存储到操作系统安全存储
- SQLite 中只存储加密后的 Key 指纹
- Node.js Sidecar 启动时通过 Rust 获取解密后的 Key（不落盘）

### 10.2 Sidecar 安全隔离

| 安全项 | 实现方式 |
|--------|---------|
| Sidecar 进程隔离 | 独立 Node.js 进程，Rust 控制生命周期 |
| HTTP Bridge 访问限制 | 仅监听 localhost，动态端口 |
| Python 代码执行 | pi-agent bash 工具，可通过 BashSpawnHook 限制工作目录 |
| 执行超时 | bash 工具支持 timeout 参数 |
| 网络访问 | pi-agent bash 工具可配置白名单命令 |

---

## 十一、分阶段实施计划

### Phase 0: 项目初始化（1周）

| 任务 | 说明 |
|------|------|
| 初始化 Tauri 2.0 项目 | `npm create tauri-app@latest` |
| 配置 Vite + React + TypeScript | 前端工具链 |
| 配置 Ant Design + Tailwind CSS | UI 基础 |
| 配置 Zustand | 状态管理 |
| 配置 SQLite (rusqlite) | 数据库 |
| 初始化 Node.js Sidecar 项目 | `src-agent/` 目录 + tsup 构建 |
| 安装 pi-agent SDK | `npm install @earendil-works/pi-coding-agent` |
| 搭建三栏布局骨架 | AppLayout + 路由 |

### Phase 1: 基础设施层（2周）

| 任务 | 说明 |
|------|------|
| 实现统一错误类型 | `error.rs` |
| 实现 SQLite 数据库 | 建表 + 迁移 |
| 实现配置管理服务 | CRUD + 连接测试 |
| 实现提示词管理服务 | CRUD + 验证 |
| 实现安全存储 | API Key 加密 |
| 实现 HTTP Bridge Server | localhost + 动态端口 |
| 实现 Sidecar Manager | 进程管理 + stdout 事件桥接 |
| pi-agent AgentSession 初始化 | 自定义工具注册 + 系统提示词 |
| 前端配置管理页面 | ModelForm + ConnectionTest |
| 前端提示词管理页面 | PromptEditor + PromptList |
| 前端 AgentChatPanel 基础版 | 消息列表 + 输入框 + 流式渲染 |

**里程碑**：可完成模型配置、提示词管理的 CRUD，右栏 Agent 可进行基本对话

### Phase 2: Excel 处理核心（2.5周）

| 任务 | 说明 |
|------|------|
| 实现 Excel 读取服务 | calamine |
| 实现 Excel 写入服务 | rust_xlsxwriter |
| 实现断点续传逻辑 | 检查结果列 |
| 实现多 Excel 管理 | 文件/Sheet/列选择 |
| 实现 Excel HTTP Bridge API | 供 pi-agent 工具调用 |
| 实现 batch_service.rs | 批量处理状态管理 |
| pi-agent read_excel / write_excel / apply_formula 工具 | 自定义工具实现 |
| 前端 Excel 上传页面 | FileDropZone + ExcelSelector |
| 前端列选择组件 | ColumnSelector |
| 前端数据预览 | ExcelTable |
| 前端公式处理页面（直接执行） | FormulaInput + FormulaPreview + 历史加载 |
| 上下文注入联动 | excelStore ↔ steerAgent |

**里程碑**：可上传 Excel、选择列、预览数据；Agent 可通过工具读写 Excel；用户可直接输入公式执行

### Phase 3: Agent 能力集成（2周）

| 任务 | 说明 |
|------|------|
| 系统提示词模板 | 各功能场景的 context 模板 |
| 公式生成多轮对话 | Agent + read_excel + apply_formula 工具 |
| 提示词生成多轮对话 | Agent + save_prompt 工具 |
| Python 代码执行 | Agent + bash 工具（生成→执行→修复） |
| 前端 ToolCallCard 组件 | 工具调用可视化 |
| 前端 CodeBlock 组件 | 代码高亮 + 复制 |
| 前端 FormulaResult 组件 | 公式结果展示 |
| Steering Message 完善 | Tab 切换 + 数据变更自动注入上下文 |

**里程碑**：Agent 可通过多轮对话生成公式、优化提示词、执行 Python 代码

### Phase 4: 批量处理（2周）

| 任务 | 说明 |
|------|------|
| 实现 BatchRunner | 复用 pi-ai Provider，逐行调用 LLM |
| 实现 pi-agent batch 工具 | start_batch / pause / stop / get_status |
| 实现直接执行命令通道 | Sidecar batch_start/pause/resume/stop stdin 命令 |
| 实现断点续传 | 每行写入后检查 |
| 实现进度上报 | BatchRunner → stdout → Rust → Tauri Events |
| 前端 LLM 批量处理页面（直接执行） | PromptSelector + ModelParamsForm + ProgressTracker + LogPanel |
| 前端公式处理页面 | 批量应用公式进度 |
| 双模式联动 | 直接执行进度同步到右栏、Agent 可查询批量状态 |

**里程碑**：可通过中栏页面选择提示词直接批量处理；也可通过 Agent 对话触发；支持暂停/续传/停止

### Phase 5: 打磨与发布（1.5周）

| 任务 | 说明 |
|------|------|
| 暗色主题 | 亮/暗/系统三模式 |
| 应用图标 | 设计 + 多尺寸 |
| 自动更新 | tauri-plugin-updater |
| Sidecar 打包 | Node.js → 单文件可执行（pkg/bun compile） |
| 安装包构建 | Windows NSIS + macOS DMG |
| 数据迁移工具 | 从旧版 JSON 导入配置 |
| 端到端测试 | 核心流程覆盖 |
| 用户文档 | 使用说明 |

---

## 十二、关键技术决策

### 12.1 为什么用 pi-agent 而非自研 LLM 服务

| 对比项 | 自研 Rust LLM 服务 | pi-agent SDK |
|--------|-------------------|--------------|
| 开发量 | ~12 人天 | ~3 人天（集成） |
| 多轮对话 | 需自建 | Agent Loop 内置 |
| 上下文压缩 | 需自建 | Auto-Compaction 内置 |
| 工具调用 | 需自建 | AgentTool 内置 |
| Python 代码执行 | 需独立 Sidecar | bash 工具直接执行 |
| 会话持久化 | 需自建 SQLite | JSONL 树状内置 |
| 流式输出 | 需手写 SSE 解析 | EventStream 内置 |
| 多 Provider | 仅 OpenAI 兼容 | 9 类 API 内置 |

### 12.2 为什么 Rust 不直接处理 LLM

| 对比项 | Rust reqwest | Node.js pi-agent |
|--------|-------------|-----------------|
| Agent 框架 | 无（需完全自研） | 完整框架 |
| SSE 解析 | 需手写 | 内置 |
| 工具调度 | 需自研 | 内置 |
| 会话管理 | 需自研 | 内置 |
| 生态 | Rust AI 库较少 | pi-agent + npm 生态 |
| 性能 | 略优 | 足够（LLM API 是瓶颈） |

LLM 调用的瓶颈在网络 I/O（每次 API 调用 1-10 秒），Rust 的性能优势在此场景不明显。pi-agent 的完整框架价值远超微小的性能差异。

### 12.3 为什么保留 Rust Excel 处理

Excel 读写是 CPU 密集 + 内存密集操作，Rust 的 calamine/rust_xlsxwriter 性能显著优于 Node.js 库。且 Rust 直接操作文件系统更安全。

### 12.4 为什么用三栏而非侧边导航+内容区

| 对比项 | 两栏（侧边导航+内容） | 三栏（Tab+数据+Agent） |
|--------|---------------------|----------------------|
| AI 对话可见性 | 需嵌入各页面，切换丢失 | 持久可见，上下文连续 |
| 联动体验 | 割裂 | 数据和对话同时可见 |
| 空间利用 | 内容区大但 AI 空间不足 | 均衡分配 |
| 一致性 | 每个页面需单独集成 | 统一 Agent 面板 |

### 12.5 HTTP Bridge vs 直接 stdin/stdout 工具调用

| 对比项 | HTTP Bridge | stdin/stdout 双向通信 |
|--------|------------|---------------------|
| 实现复杂度 | 低（标准 HTTP） | 高（需自定义协议） |
| 并发支持 | 天然支持 | 需实现请求/响应匹配 |
| 调试 | 可用浏览器/curl | 需专用工具 |
| 延迟 | ~1ms (localhost) | ~0.1ms |

HTTP Bridge 简单可靠，1ms 延迟在 LLM 场景下可忽略。

### 12.6 为什么核心功能采用双模式（直接执行 + Agent 辅助）

| 对比项 | 仅 Agent 模式 | 双模式 |
|--------|-------------|--------|
| 重复任务效率 | 每次需对话描述，即使提示词已存在 | 直接选择已保存提示词/公式，一键执行 |
| 用户操作成本 | 高（需多轮对话） | 低（表单选择 → 执行） |
| 首次使用 | 自然（对话引导） | 同样支持（Agent 辅助） |
| 实现复杂度 | 低 | 中（需额外页面 + 命令通道） |
| 适用场景 | 仅探索性任务 | 探索性 + 重复性任务均覆盖 |

原项目用户的核心使用模式是：首次通过 AI 生成提示词/公式，后续重复任务直接选择已有配置执行。仅提供 Agent 模式会显著降低重复任务的效率。

---

## 十三、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| pi-agent API 不稳定 | 中 | 高 | 锁定版本；关注 GitHub 更新；预留降级方案 |
| Node.js Sidecar 打包体积大 | 中 | 中 | 使用 Bun compile 或 pkg 压缩；探索单文件打包 |
| pi-agent 不支持某些 Provider | 低 | 中 | 可通过 `pi.registerProvider()` 扩展 |
| HTTP Bridge 安全风险 | 低 | 高 | 仅 localhost + 动态端口 + 请求验证 |
| Rust Excel 库兼容性问题 | 中 | 中 | 提前验证 calamine/rust_xlsxwriter 兼容性 |
| 三栏布局小屏适配 | 中 | 低 | 右栏可折叠；响应式断点 |
| 跨平台兼容 | 低 | 高 | 优先 Windows，macOS 后续验证 |

---

## 十四、验证计划

| 阶段 | 验证项 | 通过标准 |
|------|--------|---------|
| Phase 1 | 配置 CRUD + Agent 基本对话 | 可增删改查模型配置，右栏 Agent 可对话 |
| Phase 2 | Excel 操作 + Agent 工具调用 + 公式直接执行 | 可上传 Excel，Agent 通过工具读写数据；用户可直接输入公式执行 |
| Phase 3 | 多轮对话 + 代码执行 | Agent 可多轮生成公式、执行 Python 代码；生成后提示词/公式可保存复用 |
| Phase 4 | 批量处理双模式 | 中栏页面可选已保存提示词直接执行批量处理；Agent 也可触发批量；暂停/续传/停止正常 |
| Phase 5 | 打包分发 | 安装包正常安装运行，自动更新可用 |

---

## 十五、工作量估算

| 阶段 | 前端(人天) | Rust(人天) | Node.js/pi-agent(人天) | 总计 |
|------|-----------|-----------|----------------------|------|
| Phase 0 初始化 | 2 | 1.5 | 1 | 4.5 |
| Phase 1 基础设施 | 4 | 4 | 3 | 11 |
| Phase 2 Excel 核心 | 5 | 4.5 | 2 | 11.5 |
| Phase 3 Agent 能力 | 4 | 1 | 5 | 10 |
| Phase 4 批量处理 | 4 | 2 | 4 | 10 |
| Phase 5 打磨发布 | 3 | 2 | 1 | 6 |
| **总计** | **22** | **15** | **16** | **53** |

单人全职预计 **10-12周**，双人协作（前端+后端）可缩短至 **7-8周**。

**与原方案对比**：从 75 天缩减到 53 天，减少 29%。主要节省来自：
- 删除 Python Sidecar（-13 天）
- 删除自研 LLM 服务层（-12 天）
- 删除自研对话管理（-8 天）
- 简化前端各页面的 AI 集成（-4 天）

**双模式设计额外开销**：+5.5 天（中栏直接执行页面 UI + Rust 批量处理服务 + Sidecar 命令通道扩展），但消除了重复任务的 Agent 对话开销，长期效率更高。

---

## 十六、API 配置方案设计（审查报告 P0-1 修复）

### 16.1 需求背景

用户明确要求：
> "代码里有个默认的配置。当没有在界面中新增配置时就用默认的。如果页面中选择新增大模型api，则优先用这个，但支持失败时自动降级到默认的api配置"

### 16.2 默认模型选择

**内置免费 API（硬编码在 Rust 中）**：

| 模型 | Provider Type | 理由 |
|------|---------------|------|
| DeepSeek-V3 | `openai-completions` | 免费额度大，性能优秀，国内访问快 |
| GLM-4-Flash | `openai-completions` | 智谱免费额度充足，备用选择 |

```rust
// src-tauri/src/services/config_service.rs
pub const DEFAULT_MODELS: &[DefaultModel] = &[
    DefaultModel {
        name: "DeepSeek-V3 (默认免费)",
        api_key: "",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        provider_type: "openai-completions",
    },
    DefaultModel {
        name: "GLM-4-Flash (备用免费)",
        api_key: "",
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        model_id: "glm-4-flash",
        provider_type: "openai-completions",
    },
];
```

### 16.3 自动降级流程

```
用户发起请求
    ↓
[是否有用户配置模型？]
    ↓ Yes              ↓ No
尝试调用         直接使用 DeepSeek-V3
    ↓
[调用成功？]
    ↓ No              ↓ Yes
降级到 DeepSeek-V3   返回结果
(显示 Toast 警告)
    ↓
[调用成功？]
    ↓ No              ↓ Yes
降级到 GLM-4-Flash   返回结果
    ↓
[调用成功？]
    ↓ No              ↓ Yes
显示错误对话框      返回结果
```

### 16.4 降级实现（Node.js Sidecar）

```typescript
// src-agent/services/model-fallback.ts
export class ModelFallbackService {
  async callWithFallback(
    userModel: ModelConfig | null,
    prompt: string
  ): Promise<string> {
    const models = this.buildChain(userModel); // [用户模型, DeepSeek, GLM]
    
    for (const [index, model] of models.entries()) {
      try {
        const result = await this.callModel(model, prompt);
        
        // 如果使用了降级模型，发送警告通知
        if (index > 0) {
          await bridge.post('/api/events/notify', {
            type: 'model_fallback',
            message: `主模型失败，已自动切换到：${model.name}`
          });
        }
        
        return result;
      } catch (error) {
        if (index === models.length - 1) {
          throw new Error('所有模型均调用失败');
        }
        console.error(`模型 ${model.name} 失败，尝试下一个...`);
      }
    }
  }
}
```

---

## 十七、跨进程通信加固设计（审查报告 P0-2 修复）

### 17.1 当前风险

- ❌ Sidecar 挂起 → 主进程无限等待
- ❌ HTTP Bridge 请求无超时
- ❌ stdin/stdout 无心跳检测
- ❌ 无重连机制

### 17.2 超时机制

**Rust → Sidecar（stdin 命令）**：

```rust
// src-tauri/src/services/sidecar_manager.rs
pub async fn send_with_timeout(
    &self,
    message: &str,
    timeout: Duration,
) -> Result<(), AppError> {
    tokio::time::timeout(timeout, self.send_message(message))
        .await
        .map_err(|_| AppError::SidecarTimeout)?
        .map_err(|e| AppError::SidecarError(e.to_string()))
}
```

**Sidecar → Rust（HTTP Bridge）**：

```typescript
// src-agent/bridge.ts
async post<T>(endpoint: string, data: unknown, timeout = 30000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 17.3 心跳检测（15秒阈值）

```rust
// src-tauri/src/services/sidecar_manager.rs
pub async fn start_heartbeat_monitor(&mut self, app: AppHandle) {
    let last_heartbeat = self.last_heartbeat.clone();
    
    let task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        
        loop {
            interval.tick().await;
            let elapsed = last_heartbeat.read().await.elapsed();
            
            if elapsed > Duration::from_secs(15) {
                app.emit_all("sidecar-dead", json!({
                    "message": "Sidecar 进程失去响应",
                    "elapsed_secs": elapsed.as_secs()
                })).ok();
                break;
            }
        }
    });
}
```

### 17.4 自动重启机制

```rust
impl SidecarManager {
    pub async fn restart(&mut self, app: AppHandle) -> Result<(), AppError> {
        log::warn!("正在重启 Sidecar...");
        
        self.stop().await.ok();
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.start(app.clone()).await?;
        
        app.emit_all("sidecar-restarted", json!({
            "message": "AI Agent 已重新连接"
        })).ok();
        
        Ok(())
    }
}
```

---

## 十八、UI 状态设计规范（审查报告 P0-3 修复）

### 18.1 加载状态

**骨架屏组件**：

```tsx
// components/ui/Skeleton.tsx
export const TableSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex gap-4">
        <Skeleton className="h-10 w-12" />
        <Skeleton className="h-10 flex-1" />
      </div>
    ))}
  </div>
);
```

**进度指示器**：

```tsx
export const BatchProgress = ({ current, total, speed }: ProgressProps) => {
  const percentage = (current / total) * 100;
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{current} / {total} 行</span>
        <span>{percentage.toFixed(1)}%</span>
      </div>
      <Progress value={percentage} className="h-2" />
      <div className="text-xs text-muted-foreground">
        速度: {speed.toFixed(1)} 行/分钟
      </div>
    </div>
  );
};
```

### 18.2 错误状态

**错误边界**：

```tsx
// components/ErrorBoundary.tsx
export class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <XCircle className="w-16 h-16 text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">出错了</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {this.state.error?.message}
          </p>
          <Button onClick={() => this.setState({ hasError: false })}>
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**API 错误提示**：

```tsx
export const ApiErrorAlert = ({ error, onRetry }: ErrorAlertProps) => (
  <Alert variant="destructive">
    <AlertCircle className="h-4 w-4" />
    <AlertTitle>调用失败</AlertTitle>
    <AlertDescription className="flex items-center justify-between">
      <span>{error.message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      )}
    </AlertDescription>
  </Alert>
);
```

### 18.3 空状态

```tsx
// components/EmptyState.tsx
export const EmptyExcelState = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <FileSpreadsheet className="w-16 h-16 text-muted-foreground mb-4" />
    <h3 className="text-lg font-semibold mb-2">还没有数据</h3>
    <p className="text-sm text-muted-foreground mb-6 max-w-sm">
      请先上传 Excel 文件
    </p>
    <Button onClick={() => navigate('/data/upload')}>
      <Upload className="w-4 h-4 mr-2" />
      上传 Excel
    </Button>
  </div>
);
```

### 18.4 响应式设计

**断点定义**：

```typescript
// styles/breakpoints.ts
export const breakpoints = {
  xl: 1280,  // 三栏布局最小宽度
};

export const MIN_THREE_COLUMN_WIDTH = 1280;
```

**响应式布局**：

```tsx
// layouts/AppLayout.tsx
export function AppLayout() {
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < MIN_THREE_COLUMN_WIDTH) {
        setRightPanelCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return (
    <div className="flex h-screen">
      <nav className="w-16">...</nav>
      <main className="flex-1">...</main>
      {!rightPanelCollapsed && (
        <aside className="w-96"><AgentChatPanel /></aside>
      )}
      <Button onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}>
        {rightPanelCollapsed ? <ChevronLeft /> : <ChevronRight />}
      </Button>
    </div>
  );
}
```

**小屏提示**：

```tsx
export function ScreenSizeWarning() {
  if (window.innerWidth >= 1024) return null;
  
  return (
    <Alert className="m-4">
      <Monitor className="h-4 w-4" />
      <AlertTitle>建议使用更大的屏幕</AlertTitle>
      <AlertDescription>
        为获得最佳体验，建议使用至少 1280px 宽度的屏幕
      </AlertDescription>
    </Alert>
  );
}
```

---

## 十九、数据迁移方案（审查报告 P0-4 修复）

### 19.1 自动推断 provider_type

```rust
// src-tauri/src/migration/provider_inference.rs
pub fn infer_provider_type(base_url: &str, model_id: &str) -> String {
    if base_url.contains("api.openai.com") {
        return "openai-chat".to_string();
    }
    if base_url.contains("api.anthropic.com") {
        return "anthropic-messages".to_string();
    }
    if base_url.contains("api.deepseek.com") {
        return "openai-completions".to_string();
    }
    if base_url.contains("open.bigmodel.cn") {
        return "openai-completions".to_string(); // GLM
    }
    
    // 基于 model_id 推断
    if model_id.starts_with("gpt-") {
        return "openai-chat".to_string();
    }
    if model_id.starts_with("claude-") {
        return "anthropic-messages".to_string();
    }
    
    // 默认降级
    "openai-completions".to_string()
}
```

### 19.2 迁移脚本

```rust
// src-tauri/src/migration/mod.rs
pub async fn migrate_v1_to_v2(db: &Database) -> Result<(), MigrationError> {
    let old_config_path = dirs::config_dir()
        .ok_or(MigrationError::ConfigDirNotFound)?
        .join("ai-sheet")
        .join("model_config.json");
    
    if !old_config_path.exists() {
        return Ok(());
    }
    
    let old_content = fs::read_to_string(&old_config_path)?;
    let old_configs: Vec<OldModelConfig> = serde_json::from_str(&old_content)?;
    
    for old_cfg in old_configs {
        let provider_type = infer_provider_type(&old_cfg.base_url, &old_cfg.model_id);
        
        let new_cfg = ModelConfig {
            name: old_cfg.name,
            api_key: encrypt_api_key(&old_cfg.api_key)?,
            base_url: old_cfg.base_url,
            model_id: old_cfg.model_id,
            provider_type, // ← 自动推断
            is_default: old_cfg.is_default,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };
        
        db.insert_model(new_cfg).await?;
    }
    
    // 备份旧配置
    fs::rename(&old_config_path, old_config_path.with_extension("json.backup"))?;
    
    Ok(())
}
```

---

## 二十、批量处理增强设计（审查报告 P0-5 修复）

### 20.1 暂停/恢复机制

```typescript
// src-agent/batch/runner.ts
export class BatchRunner {
  private pauseSignal: { paused: boolean } = { paused: false };
  
  async run(params: BatchParams, onProgress: ProgressCallback) {
    for (let i = 0; i < data.rows.length; i++) {
      // 检查暂停信号
      while (this.pauseSignal.paused && !this.abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.abortController.signal.aborted) {
        await this.saveCheckpoint(params.batchId, i);
        break;
      }
      
      // 处理行...
    }
  }
  
  pause() { this.pauseSignal.paused = true; }
  resume() { this.pauseSignal.paused = false; }
  stop() { this.abortController?.abort(); }
}
```

### 20.2 断点续传

```typescript
interface BatchCheckpoint {
  batchId: string;
  lastIndex: number;
  timestamp: string;
}

class CheckpointManager {
  async save(batchId: string, index: number) {
    await fs.writeFile(
      `${this.checkpointPath}/${batchId}.json`,
      JSON.stringify({ batchId, lastIndex: index, timestamp: new Date().toISOString() })
    );
  }
  
  async load(batchId: string): Promise<BatchCheckpoint | null> {
    try {
      const content = await fs.readFile(`${this.checkpointPath}/${batchId}.json`, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
```

### 20.3 网络容错

```typescript
async processRow(row: RowData, params: BatchParams): Promise<string> {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.callLLM(row, params);
    } catch (error) {
      if (this.isRetriable(error) && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

private isRetriable(error: any): boolean {
  return ['ECONNRESET', 'ETIMEDOUT', 'rate_limit_exceeded'].some(code =>
    error.code === code || error.message?.includes(code)
  );
}
```

---

## 二十一、修订后的开发计划（审查报告修正）

### 21.1 工时调整

| Phase | 原计划 | 修正后 | 增量 | 说明 |
|-------|--------|--------|------|------|
| Phase 0 | 4.5d | 5.5d | +1d | API 降级方案 + 通信加固 |
| Phase 1 | 11d | 14d | +3d | UI 状态组件 + 响应式 + 数据迁移 |
| Phase 2 | 11.5d | 11.5d | - | 无变更 |
| Phase 3 | 10d | 11d | +1d | 错误恢复增强 |
| Phase 4 | 10d | 12d | +2d | 批量处理断点续传 + 网络容错 |
| Phase 5 | 6d | 8d | +2d | 额外集成测试 |
| **总计** | **53d** | **62d** | **+9d** | +17% 工时 |

### 21.2 时间线预估

- **单人全职**：12-14周（原 10-12周）
- **双人协作**：8-9周（原 7-8周）

---

## 二十二、验证清单补充（审查报告要求）

| 编号 | 验证项 | 验收标准 |
|------|--------|---------|
| V-API-1 | 默认配置可用 | 删除所有用户配置 → 应用仍可调用 DeepSeek-V3 |
| V-API-2 | 降级通知 | 用户配置失败 → 显示黄色 Toast 通知 |
| V-COM-1 | Sidecar 自动重启 | 手动杀死 Node.js 进程 → 15秒内自动重启 |
| V-COM-2 | HTTP 超时 | 模拟 Bridge 延迟30秒 → 抛出超时错误 |
| V-UI-1 | 加载骨架屏 | Excel 加载时显示 TableSkeleton |
| V-UI-2 | 错误提示 | API 失败时显示 ApiErrorAlert 带重试按钮 |
| V-UI-3 | 空状态引导 | 无数据时显示 EmptyExcelState |
| V-UI-4 | 响应式折叠 | 窗口缩小到1024px → 右栏自动折叠 |
| V-MIG-1 | 自动迁移 | 放置旧版配置 → 启动时自动迁移 |
| V-MIG-2 | Provider 推断 | 迁移后所有模型 provider_type 正确 |
| V-MIG-3 | API Key 加密 | 迁移后 SQLite 中 api_key 字段已加密 |
| V-BAT-1 | 批量暂停 | 批量处理中点击暂停 → 当前行完成后暂停 |
| V-BAT-2 | 断点续传 | 暂停后关闭应用 → 重启后从断点继续 |
| V-BAT-3 | 网络重试 | 模拟网络故障 → 自动重试3次（指数退避） |

---

## 二十三、补充风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 默认 API 配额耗尽 | 高 | 中 | 文档明确说明用户应配置自己的 API Key；默认仅用于初次体验 |
| 15秒心跳误判 | 低 | 低 | 允许通过配置文件调整心跳阈值（默认15秒） |
| 小屏(<1280px)体验差 | 中 | 中 | 显示屏幕尺寸警告；右栏自动折叠；保证核心功能可用 |
| 断点文件损坏 | 低 | 中 | Checkpoint 损坏时重新开始并记录日志；不影响原始数据 |
| Provider 推断错误 | 低 | 中 | 迁移后提供手动校正入口；日志记录推断结果供用户检查 |

---

**方案版本**：v2.1（根据技术审查报告全面修订）  
**更新日期**：2026-06-05  
**审查依据**：[tasks/review-report.md](../../tasks/review-report.md)
