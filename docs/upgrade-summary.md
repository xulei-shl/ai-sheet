# AI-Sheet 升级方案评估总结

> 评估范围：升级方案设计 vs 功能需求 vs 当前实现
> 评估日期：2026-06-06

---

## 一、总体结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 方案设计 | ✅ 覆盖 90% | 多文件/Sheet/列加载、三种处理路径、结果预览与写回均有设计 |
| 当前实现 | ✅ 核心层完成 | 数据模型、Excel 读取服务、状态管理、HTTP Bridge、前端上传/选择/预览、公式页面、pi-agent 集成、BatchRunner 均已实现 |
| 推进建议 | ✅ 继续推进 | 已具备完整 Agent 对话和批量处理能力，建议推进前端 LLM 批量页面和 Rust Excel 写入 |

---

## 二、核心需求覆盖

### 2.1 Excel 上传/选择/预览

| 需求 | 方案设计 | 方案位置 |
|------|---------|---------|
| 上传 1-2 个 Excel | `excelStore.files: ExcelFileInfo[]` + `addFile()` | 1039 |
| 单 Excel 多 Sheet | `selectSheets(fileIndex, sheets[])` 支持多选 | 1048 |
| 双 Excel 各 1 Sheet | `MultiExcelSelection[]` 支持独立选择 | 1041 |
| 单列/多列选择 | `selectColumns(fileIndex, sheet, columns[])` | 1049 |
| 每 Sheet 独立选列 | 参数含 `fileIndex + sheet`，按 sheet 隔离 | 同上 |
| 预览数据 | `loadPreview()` → `previewData` state | 1050 |
| 上下文注入 Agent | `notifyContextChange()` → Steering Message | 1151-1169 |

**数据模型设计**：支持 1 或多个 Excel → 每个 Excel 选多个 Sheet → 每个 Sheet 选多个列 → 独立预览。

### 2.2 三种处理路径

| 路径 | 直接执行 | Agent 辅助 |
|------|---------|-----------|
| **公式** | `FormulaInput` 输入公式 → Rust `apply_formula` | Agent 对话生成 → `apply_formula` tool |
| **提示词 LLM** | 选提示词 → `BatchRunner` 逐行处理 | Agent 对话生成提示词 → `start_batch` tool |
| **Python 代码** | — | Agent 对话生成代码 → `bash` tool 执行 + 自动修复 |

**双模式设计原则**（方案 3.4）：
- Agent 是"生成器"（首次创作、迭代优化）
- 中栏页面是"执行器"（复用已有配置、批量跑任务）

**提示词选择逻辑**（方案 6.5.2）：
1. 下拉框选择已保存提示词
2. 自定义输入提示词
3. 可选"保存当前提示词"

### 2.3 Python 代码执行（Agent bash）

- **输入**：Agent 通过 `read_excel` tool 读取数据，`loadedFiles[]` 通过 Steering Message 传递路径
- **执行**：pi-agent `bash` tool → 系统 Python 进程
- **修复**：Agent Loop 自动检测错误并修复（最多 3 次）
- **输出**：Python 脚本通过 Excel 库直接写路径，或调用 `write_excel` tool

你的策略正确：Agent 可直接 `bash` 执行 Python，Excel 有本地路径，无需受控传入。

### 2.4 结果预览与写回

| 处理方式 | 预览 | 写回目标 |
|---------|------|---------|
| 公式 | `FormulaPreview` 前 3 行 | `apply_formula(path, sheet, column, formula)` |
| LLM 批量 | `ProgressTracker` + `BatchLogPanel` 逐行日志 | `write_excel(path, sheet, results)` |
| Python | `ExecutionResult` + 日志 | Agent 指定路径/列 |

---

## 三、设计缺口（3 处轻微）

### 3.1 Python 结果预览缺两阶段确认

方案提到 `ExecutionResult.tsx`，但没有像公式那样设计"执行前预览 → 确认写回"的流程。

**建议**：Python 处理也增加结果预览 + 确认写回步骤。

### 3.2 公式预览无编辑能力

`FormulaPreview` 只展示前 3 行，但没说能否修改公式后重新预览。

**建议**：预览后允许用户编辑公式再应用。

### 3.3 跨文件公式引用未定义

未说明公式引用两个不同 Excel/Sheet 时的格式（如 `=VLOOKUP(A2, [wb2.xlsx]Sheet1!$A$1:$B$100, 2, FALSE)`）。

**建议**：明确跨文件引用规则，参考旧版 `selected_columns` 统一输入的做法。

---

## 四、实现状态

### 4.1 已完成（Phase 0-4，约 25-30 天）

**Phase 0-3 基础层**：
- Vite + React + Tauri 脚手架
- 三栏布局 + 导航 + 状态管理
- UI 状态组件（Empty/Error/Loading）
- Mock Node.js Sidecar + JSONL 协议
- Rust Sidecar Manager（进程管理 + 心跳检测 + steer/stop_stream）
- 内置默认模型（DeepSeek + GLM 降级）
- Excel 数据模型（`src/types/excel.ts`）
- 批量处理数据模型（`src/types/processing.ts`）
- Agent 类型扩展（ToolCall/ToolResult/AgentContext/SidecarEvent）
- Rust Excel 读取服务（calamine：get_info/get_column_names/get_sample_data/get_column_data/get_processing_status）
- Rust HTTP Bridge Server（localhost 动态端口，6 个 API 端点）
- Rust 提示词数据模型
- `excelStore`（Zustand：多文件/多Sheet/多列选择 + 预览 + 上下文注入）
- `processingStore`（Zustand：批量处理进度管理）
- Tauri IPC 命令（10 个 Excel 命令 + steer_agent/stop_agent_stream）
- 前端 FileDropZone 拖放上传组件
- 前端 ExcelTable 预览表格组件
- 前端 ColumnSelector 列选择组件
- 前端 DataPage（完整上传 → Sheet 选择 → 列选择 → 预览流程）
- 前端 FormulaPage（文件/Sheet/列选择器 + 公式输入 + 预览 + 应用）
- pi-agent 集成（真实 AgentSession + 4 类自定义工具 + 系统提示词注入）
- BatchRunner（Node.js，逐行 pi-ai stream + 断点续传 + 暂停/恢复 + 指数退避重试）

**2026-06-06 新增**：
- Rust Excel 写入服务（rust_xlsxwriter）：`write_results` / `apply_formula` 完整实现
- `configStore`（Zustand）：模型配置 CRUD + localStorage 持久化 + 连接测试
- `promptStore`（Zustand）：提示词 CRUD + 搜索 + localStorage 持久化
- `processingStore` 重写：真实 Tauri IPC 调用 + 批量事件订阅
- 注册缺失命令：`steer_agent`、`stop_agent_stream` 现已注册
- 新增类型：`src/types/prompt.ts`
- LLM 批量处理页面（`LLMProcessingPage`）：完整批量处理 UI（进度条/日志/暂停恢复控制）
- Python 处理页面（`PythonProcessingPage`）：脚本编辑器 + 执行 + 输出面板
- 配置管理页面（`ConfigPage`）：完整 CRUD + 测试连接 + 内置模型展示
- 提示词管理页面（`PromptsPage`）：完整 CRUD + 搜索过滤
- AiPage 子导航：提示词生成 / LLM 批量处理 / Python 处理 三 Tab 切换

### 4.2 未实现（剩余约 10-15 天）

| 模块 | 设计文档 | 实现进度 |
|------|---------|---------|
| Tauri 插件（dialog/fs/updater/加密存储） | Phase 1 | 0% |
| 单元测试 / E2E 测试 | — | 0% |
| 跨文件公式引用 | — | 未设计 |

---

## 五、旧版 Python 可复用参考

| 旧模块 | 对应新服务 | 位置 |
|--------|-----------|------|
| `multi_excel_utils.py` — `MultiExcelManager` | Rust `excel_service.rs` + React `excelStore.ts` | `docs/source_code/.../modules/` |
| `multi_excel_selector.py` — `MultiExcelSelector`/`ExcelSheetSelector` | React Excel 选择组件 | `docs/source_code/.../ui/` |
| `column_utils.py` | Rust column 工具函数 | 同上 |
| `llm_batch_processor.py` | `BatchRunner`（Node.js） | 同上 |
| `python_code_processor.py` | pi-agent 对话 + bash | 同上 |

---

## 六、本次优化完成内容

### 6.1 数据模型层

| 文件 | 内容 |
|------|------|
| `src/types/excel.ts` | ExcelFileInfo, SheetInfo, ColumnInfo, PreviewData, FileSelection, SampleData, ColumnData, ApplyFormulaRequest, ProcessingStatus |
| `src/types/processing.ts` | BatchStartParams, BatchProgress, BatchLog, BatchStatus |
| `src/types/agent.ts` | 扩展: ToolCall, ToolResult, AgentContext, 新增 SidecarEvent 变体 |
| `src-tauri/src/models/excel.rs` | Rust 侧 Excel 数据结构 |
| `src-tauri/src/models/prompt.rs` | Rust 侧提示词数据结构 |

### 6.2 状态管理层

| Store | 核心能力 |
|-------|---------|
| `excelStore` | 多文件/多 Sheet/多列选择、预览数据加载、`notifyContextChange()` 上下文注入 Agent |
| `processingStore` | 批量处理进度追踪、暂停/恢复/停止、日志管理 |

### 6.3 Rust 后端

| 模块 | 功能 |
|------|------|
| `services/excel_service.rs` | 5 个读取方法：get_info, get_column_names, get_sample_data, get_column_data, get_processing_status |
| `services/bridge_server.rs` | HTTP Bridge（localhost 动态端口），6 个 API 端点供 pi-agent 工具调用 |
| `services/sidecar_manager.rs` | 新增 steer() 和 stop_stream() 方法 |
| `commands/excel.rs` | 10 个 Tauri IPC 命令 |
| `commands/sidecar.rs` | 新增 steer_agent / stop_agent_stream 命令 |

### 6.4 前端组件

| 组件 | 功能 |
|------|------|
| `FileDropZone` | 拖放/点击上传 Excel（支持 .xlsx/.xls） |
| `ExcelTable` | 数据预览表格（列头 + 行数据 + 总数提示） |
| `ColumnSelector` | 多选列按钮组 |

### 6.5 页面优化

| 页面 | 优化内容 |
|------|---------|
| `DataPage` | 完整流程：文件上传 → Sheet 列表展开/折叠 → 列选择 → 预览表格 |
| `FormulaPage` | 文件/Sheet/列三级选择器 + 公式输入 + 预览前 3 行 + 批量应用 |
| `AiPage` | 三个功能卡片（提示词生成、LLM 批量、Python 处理） |
| `AgentChatPanel` | 支持新事件类型（tool_start/tool_end/batch_progress 等） |

### 6.6 依赖变更

| 变更 | 说明 |
|------|------|
| + calamine 0.26 | Rust Excel 读取（纯 Rust，无外部依赖） |
| + tokio net 特性 | 支持 HTTP Bridge Server |

### 6.7 pi-agent 集成与 BatchRunner（2026-06-06）

| 模块 | 文件 | 功能 |
|------|------|------|
| **协议扩展** | `src-agent/src/protocol.ts` | 扩展 SidecarCommand/SidecarEvent，新增 batch 命令和事件类型 |
| **Bridge 客户端** | `src-agent/src/bridge.ts` | HTTP Bridge 客户端，包装 GET/POST，30s 超时 |
| **AgentSession** | `src-agent/src/agent.ts` | 创建 AgentSession，注册自定义工具，加载系统提示词 |
| **系统提示词** | `src-agent/src/prompts/system.ts` | AI-Sheet 专用 system prompt，动态注入当前上下文 |
| **Excel 工具** | `src-agent/src/tools/excel-tools.ts` | read_excel / write_excel / apply_formula |
| **配置工具** | `src-agent/src/tools/config-tools.ts` | get_config / test_connection |
| **提示词工具** | `src-agent/src/tools/prompt-tools.ts` | get_prompts / save_prompt |
| **Batch 工具** | `src-agent/src/tools/batch-tools.ts` | start_batch / pause_batch / get_batch_status |
| **BatchRunner** | `src-agent/src/batch/runner.ts` | 逐行 pi-ai stream，断点续传，3 次指数退避重试，暂停/恢复 |
| **进度上报** | `src-agent/src/batch/progress.ts` | ProgressTracker：速度统计、状态通知 |
| **入口** | `src-agent/src/main.ts` | stdin JSONL 路由，AgentSession 事件桥接，批量处理管理 |
| **Rust 适配** | `src-tauri/src/services/sidecar_manager.rs` | 新增 `--bridge-port` 传递、set_bridge_port()、send_batch_command() |
| **Bridge 扩展** | `src-tauri/src/services/bridge_server.rs` | 新增 9 个 API 端点（config/batch/prompts） |
| **启动流程** | `src-tauri/src/lib.rs` | 修正启动顺序：先 Bridge → 再 Sidecar 并传递端口 |

**关键设计决策**：
- 批量处理不走 Agent Loop，直接使用 pi-ai `stream()`，避免每行工具调度开销
- BatchRunner 独立于 AgentSession，支持直接执行（中栏页面）和 Agent 工具触发（右栏对话）双模式
- 通信协议保持 JSONL + stdin/stdout，与 Rust SidecarManager 完全兼容

### 6.8 Excel 写入 + 页面完整化（2026-06-06）

| 模块 | 文件 | 功能 |
|------|------|------|
| **Excel 写入** | `src-tauri/Cargo.toml` | 新增依赖：rust_xlsxwriter 0.77, uuid 1 |
| **Excel 写入** | `src-tauri/src/error.rs` | 新增 `AppError::Excel` + `From<XlsxError>` |
| **Excel 写入** | `src-tauri/src/services/excel_service.rs` | 实现 `write_results()` 和 `apply_formula()`（calamine 读 → rust_xlsxwriter 写 → 替换原文件） |
| **命令注册** | `src-tauri/src/lib.rs` | 注册 `steer_agent` / `stop_agent_stream` 到 invoke_handler |
| **配置 Store** | `src/stores/configStore.ts` | 模型配置 CRUD + localStorage 持久化 + testConnection() |
| **提示词 Store** | `src/stores/promptStore.ts` | 提示词 CRUD + 搜索过滤 + localStorage 持久化 |
| **处理 Store** | `src/stores/processingStore.ts` | 重写：真实 IPC 调用 + 事件订阅（batch-progress / row-complete / done / error） |
| **类型** | `src/types/prompt.ts` | Prompt / PromptInput 接口定义 |
| **API** | `src/services/tauri.ts` | 新增 `getFallbackModels()` |
| **LLM 批量页面** | `src/pages/LLMProcessingPage.tsx` | 文件/Sheet/列选择器 + 提示词选择（已保存/自定义）+ 温度 + 进度条 + 日志面板 + 开始/暂停/继续/停止 |
| **Python 页面** | `src/pages/PythonProcessingPage.tsx` | 脚本编辑器 + 模板生成 + 本地执行 + 输出面板 |
| **配置页面** | `src/pages/ConfigPage.tsx` | 完整 CRUD：新增/编辑/删除模型 + 测试连接 + 内置模型展示 |
| **提示词页面** | `src/pages/PromptsPage.tsx` | 完整 CRUD：新增/编辑/删除 + 搜索过滤 + 空状态 |
| **AI 页面** | `src/pages/AiPage.tsx` | 子导航：提示词生成 / LLM 批量处理 / Python 处理 三 Tab 切换 |

---
## 八、2026-06-07 新增完成内容

### 8.1 SQLite 数据库持久化

| 文件 | 内容 |
|------|------|
| `src-tauri/src/db/mod.rs` | Database 结构体（WAL 模式、连接管理）、SharedDatabase 别名 |
| `src-tauri/src/db/migrations.rs` | 5 张表 schema：models, prompts, formula_cache, settings, schema_version |
| `src-tauri/src/db/models_repo.rs` | 用户模型 CRUD（get_all, insert, update, delete, get_by_index） |
| `src-tauri/src/db/prompts_repo.rs` | 提示词 CRUD（get_all, insert, update, delete） |
| `src-tauri/src/db/formula_cache_repo.rs` | 公式缓存 CRUD（get_all, insert, touch） |
| `src-tauri/src/error.rs` | 新增 `AppError::Database` + `From<rusqlite::Error>` |
| `src-tauri/src/commands/config.rs` | 新增 `get_user_models`, `add_user_model`, `update_user_model`, `delete_user_model` |
| `src-tauri/src/commands/prompt.rs` | 新增 `get_all_prompts`, `save_prompt`, `update_prompt`, `delete_prompt` |
| `src-tauri/src/commands/formula_cache.rs` | 新增 `get_formula_history`, `save_formula_cache`, `touch_formula_cache` |
| `src-tauri/src/services/bridge_server.rs` | `/api/prompts` 端点改用 SQLite 查询 |
| `src-tauri/src/lib.rs` | 启动时初始化数据库 + 注册 11 个新命令 |
| `src/stores/configStore.ts` | 用户模型从 localStorage 迁移到 SQLite（Tauri IPC） |
| `src/stores/promptStore.ts` | 提示词从 localStorage 迁移到 SQLite（Tauri IPC） |
| `src/types/config.ts` | `ModelConfig` 新增 `id?: number` |

### 8.2 公式历史缓存

| 文件 | 内容 |
|------|------|
| `src-tauri/src/models/formula_cache.rs` | FormulaCacheEntry 模型定义 |
| `src/types/formula.ts` | 前端 FormulaCacheEntry 类型 |
| `src/services/tauri.ts` | `getFormulaHistory`, `saveFormulaCache`, `touchFormulaCache` API |
| `src/pages/FormulaPage.tsx` | 加载历史下拉列表、自动保存公式到缓存、点击历史项填充公式 |

### 8.3 错误边界

| 文件 | 内容 |
|------|------|
| `src/components/ui/ErrorBoundary.tsx` | 类组件 + `getDerivedStateFromError` + 重试按钮 |
| `src/main.tsx` | `<App>` 外层包裹 ErrorBoundary |

### 8.4 响应式布局

| 文件 | 内容 |
|------|------|
| `src/layouts/AppLayout.tsx` | resize 监听 + < 1280px 自动折叠右栏 + < 1024px 警告横幅 |
| `src/stores/uiStore.ts` | 新增 `setRightSidebarCollapsed` action |

### 8.5 键盘快捷键

| 文件 | 内容 |
|------|------|
| `src/hooks/useKeyboardShortcuts.ts` | 全局快捷键：Ctrl+K（聚焦 AI 输入）、Ctrl+B（左栏切换）、Ctrl+\\（右栏切换）、Escape（关闭右栏） |
| `src/components/agent/AgentInput.tsx` | 新增 `data-ai-input` 属性供 Ctrl+K 定位 |

### 8.6 Tauri 插件集成

| 插件 | 用途 | 实现内容 |
|------|------|---------|
| `tauri-plugin-dialog` | 原生文件对话框 | 替换 DataPage 中 HTML `<input type="file">`，支持多选 + Excel 过滤器 |
| `tauri-plugin-fs` | 文件系统权限 | 配置读取/写入/创建/删除权限 |
| `tauri-plugin-store` | 加密存储 | API Key 分离存储到独立 JSON 文件 |
| `tauri-plugin-updater` | 自动更新 | 配置 endpoints 和对话框 |

**变更文件**：
| 文件 | 变更 |
|------|------|
| `src-tauri/Cargo.toml` | +4 个 plugin crate |
| `src-tauri/src/lib.rs` | 注册 4 个插件到 Tauri Builder |
| `src-tauri/capabilities/default.json` | 添加所有插件权限 |
| `src-tauri/tauri.conf.json` | 添加 updater 和 store 插件配置 |
| `src/pages/DataPage.tsx` | 使用 `open()` from `@tauri-apps/plugin-dialog` 替换 HTML input |
| `src/stores/configStore.ts` | 添加 `secureStore` 分离 API Key 存储 |
| `src/services/secureStore.ts` | 新建：封装 `@tauri-apps/plugin-store` 的 Store API |
| `package.json` | +4 个 `@tauri-apps/plugin-*` npm 包 |

### 8.7 Rust 单元测试

| 模块 | 测试数 | 覆盖内容 |
|------|--------|---------|
| `config_service.rs` | 4 | active_model, fallback_chain, model_data, to_model_config |
| `excel_service.rs` | 11 | get_info, columns, sample, column_data, write, formula, status, error cases |
| `models_repo.rs` | 7 | 完整 CRUD + 空库 + 多插入 + 索引查询 |
| `prompts_repo.rs` | 4 | 完整 CRUD + 多插入 |
| `formula_cache_repo.rs` | 4 | 插入/查询/touch/空库 |

**测试策略**：SQLite 用 `open_in_memory()` + 迁移，Excel 用 `rust_xlsxwriter` 创建临时文件。发现并修复了 `get_sample_data` 中 data row 计数 bug。

**验证结果**：
- `cargo test` — 28 passed, 0 failed
- `cargo check` — 0 errors, 0 warnings
- `npm run typecheck` — passed
