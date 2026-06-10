# Design

> AI-Sheet 综合设计与架构文档（v9，2026-06-10）
>
> v9 变更：路径统一与资源打包——`.pi/` 目录和 `src-agent/dist/` 捆绑为 Tauri 资源，
> 首次运行时自动复制到 `app_data_dir`；Rust skill 命令移除 `project_root` 参数，
> 改用 `app.path().app_data_dir()`；AGENTS.md 从 `initialCwd`（即 `--db-dir` 传入的 app_data_dir）
> 读取；新增 SYSTEM.md 身份定义 + systemPromptOverride 显式注入（与 AGENTS.md 一致的双注入模式）；
> 前端 `SkillsPage` 不再通过 `import.meta.url` 推断项目根路径。
> 三端（Rust、Agent、前端）统一使用 `app_data_dir()` 作为基准路径。
>
> v8 变更：新增 AGENTS.md 元规则机制——`.pi/AGENTS.md` 定义 agent 身份、
> 交互规则、Excel 专业规则、Python 执行规则、回答风格等元规则；
> 通过 `DefaultResourceLoader.agentsFilesOverride` 注入系统提示词，
> 与动态 cwd 解耦，确保任意工作目录下均可加载；
> 原 `system.ts` 中硬编码的静态角色与规则迁移至 AGENTS.md，
> 动态上下文（文件信息、样例数据）仍由 `session.steer()` 注入。
>
> v7 变更：新增技能管理模块——Rust 后端 Skill 命令（文件系统 CRUD）、
> 前端 SkillsPage（三栏布局：技能列表+文件树+内容预览）、
> DefaultResourceLoader 自动发现 `.pi/skills/` 下所有技能，移除 skillsOverride 硬编码；
> 技能目录支持多文件/子目录，通过 FileNode 树递归浏览。
>
> v6 变更：pi agent 动态工作目录机制——默认 cwd 为 DB 数据目录，加载 Excel 后自动切换到文件所在目录；
> 通过 DefaultResourceLoader 自动发现 .pi/skills 下所有技能，与 cwd 解耦；
> 新增 set_cwd 协议命令和 cwd_changed 事件。
>
> 适用范围：Tauri 2.0 + React + pi-agent + Rust 三进程桌面应用。
> 取代此前散落在 `docs/` 下的多份方案稿（upgrade-plan-tauri-react.md、
> multi-turn-conversation-design.md、precious-snuggling-avalanche.md、
> upgrade-summary.md 等），后者保留为历史归档。
>
> 与本文档配套：
> - `PRODUCT.md`：产品定位、用户画像、品牌人格、非功能指标
> - `AGENT.md`：编码行为准则
> - `docs/HANDOFF.md`：开发交接、当前实现状态、下一阶段任务
> - `docs/PROTOCOL.md`：跨进程通信与 Sidecar JSONL 协议细节

---

## 0. 阅读路径

```
产品定位        ── PRODUCT.md
设计令牌        ── 本文档 §1、§2、§3
技术栈与理由    ── 本文档 §4
进程与通信架构  ── 本文档 §5
模块与目录      ── 本文档 §6
数据模型        ── 本文档 §7
核心机制        ── 本文档 §8
双模式设计      ── 本文档 §9
安全 / 错误 / 响应式 ── 本文档 §10、§11、§12
落地状态 / 待办  ── docs/HANDOFF.md
协议细节        ── docs/PROTOCOL.md
```

---

## 1. 设计令牌（Design Tokens）

> 视觉体系的基础原语。本节与 `src/styles/globals.css` 中的 CSS 变量一一对应。

### 1.1 色彩策略：克制（Monochrome + Accent）+ 双模式

整个 UI 建立在**低饱和度灰阶**之上，让数据本身成为视觉中心。
品牌色仅在 AI 交互、主操作和聚焦高亮时出现。

应用支持**深色 / 浅色双模式**，由用户手动选择或跟随系统。
模式通过 `<html data-theme-mode="dark|light">` 切换，对应 CSS 中
`[data-theme-mode="dark"]` 和 `[data-theme-mode="light"]` 两个
独立的 token 块。token 选用 Wilderness（深色）与 WoodAsh（浅色）
两套色板，定义在 `src/styles/globals.css` 中，详细规范见
`docs/changelog/颜色升级/颜色设计升级.md`。

#### 1.1.1 模式色板速览

| 语义 | 暗色 Wilderness | 浅色 WoodAsh |
|------|-----------------|---------------|
| 主色 | `#9db56d` 橄榄绿 | `#3f50a3` 靛蓝 |
| 强背景 | `#2d353b` 深灰绿 | `#dddbc7` 暖灰 |
| 面板层 | `#232a2e` 深石板 | `rgb(206,205,180)` 豆沙 |
| 主文本 | `#ece4d0` 暖米白 | `#343250` 深靛蓝 |
| 次级文本 | `#dfd6bf` 米色 | `#455a67` 蓝灰 |
| 浅文本 | `#d1c8b4` 浅米 | `#516979` 浅蓝灰 |
| 代码块 | `#232a2e` | `rgb(206,205,180)` |
| 工具栏 | `#444e54` | `#e7e6d3` |
| 悬停 | `rgba(115,132,81,0.5)` | `rgba(190,187,153,0.5)` |
| 引述 | `#9ca6ac` | `#858371` |

#### 1.1.2 双层 Token 架构

`globals.css` 维护两套 token，互为别名，因此旧组件无需迁移：

1. **B3 / QYL 语义层**（`--b3-theme-primary`、`--b3-theme-background`、
   `--b3-list-hover`、`--QYL-Aero-background` 等 30+ 变量）：完整
   覆盖 B3 笔记主题的语义角色，可被新组件直接引用。
2. **Legacy 简写层**（`--bg`、`--surface`、`--primary`、`--ink`、
   `--success` 等）：通过 `var(--b3-theme-*)` 别名指向 B3 层，保留
   `var(--bg)`、`var(--primary)` 等历史用法。

```css
[data-theme-mode="dark"] {
  --b3-theme-primary: #9db56d;
  --b3-theme-background: #2d353b;
  --b3-theme-surface: #232a2e;
  /* ... */
  --b3-theme-on-background: #ece4d0;
  --b3-theme-on-surface: #dfd6bf;
  --b3-list-hover: rgba(115,132,81,0.5);
  --b3-tooltips-shadow: 0 13px 25px -2px rgba(175,214,98,0.12), 0 0 10px 0 rgba(175,214,98,0.12);
  /* ... */
}

[data-theme-mode="light"] {
  --b3-theme-primary: #3f50a3;
  --b3-theme-background: #dddbc7;
  --b3-theme-surface: rgb(206,205,180);
  /* ... */
}

:root,
[data-theme-mode="dark"] {
  --bg: var(--b3-theme-background);
  --surface: var(--b3-theme-surface);
  --ink: var(--b3-theme-on-background);
  --primary: var(--b3-theme-primary);
  --primary-glow: rgba(175, 214, 98, 0.18);
  /* ... */
}
```

#### 1.1.3 状态语义色

`--success` / `--error` / `--warning` 不在 B3 色板中，由项目按
两套模式分别定义，确保对当前背景有 ≥ 4.5:1 对比度：

| Token | 暗色 | 浅色 |
|-------|------|------|
| `--success` | `#9bc28f` 鼠尾草绿 | `#5a8259` 森林绿 |
| `--error`   | `#e08c8c` 柔玫瑰   | `#a14d4d` 砖红   |
| `--warning` | `#d8b66e` 暖琥珀   | `#a87a2c` 深赭   |

### 1.1.4 主题切换机制

- **状态**：`uiStore.themeMode: 'system' | 'light' | 'dark'`，持久化
  到 `localStorage['ai-sheet:theme-mode']`。
- **解析**：`useTheme()` 钩子订阅 store + `matchMedia`，
  将 `"system"` 实时解析为 `"dark"` / `"light"`，并写入
  `<html data-theme-mode="...">`。
- **预挂载防闪烁**：`index.html` 在 React 挂载前以同步脚本
  从 `localStorage` + `matchMedia` 预解析并设置 `data-theme-mode`，
  避免出现亮↔暗的瞬时闪烁。
- **用户控件**：标题栏右侧的 `ThemeToggle` 按钮（太阳 / 月亮 / 显示器
  图标）按 `system → light → dark → system` 顺序循环切换，
  `title` 与 `aria-label` 显示当前模式名称。
- **Tailwind `color-scheme`**：原生表单控件（`<input>`、滚动条等）
  的系统色阶由 `[data-theme-mode]` 上的 `color-scheme: dark|light`
  控制，确保 native widget 与 UI 一致。

### 1.2 字体

| 用途 | 字体栈 |
|---|---|
| 系统 | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| 等宽（公式、代码、表格数据） | `JetBrains Mono, "Fira Code", monospace` |

字号阶梯：`text-xs` (12px) / `text-sm` (14px, 主用) / `text-base` (16px) / `text-lg` (18px)。

### 1.3 动效原则

- **AI 流式输出**：`opacity-0 → opacity-100`，`300ms ease-out`。
- **工具调用卡片**：折叠展开使用 `grid-template-rows` 平滑过渡，激活边框带 `box-shadow` 呼吸光。
- **按钮 hover**：仅做 `background-color` 过渡 (`duration-150 ease-out`)，不做缩放位移。
- 全部遵守 `prefers-reduced-motion`。

---

## 2. 三栏布局（App Shell）

主窗口为**三栏扁平布局**，栏间用 1px 半透明边分隔（`--border`）。

```
┌────────┬────────────────────────┬──────────────────────┐
│ 64px   │  flex-1                │  384px（可调）         │
│ 导航   │  数据 / 页面           │  AI Agent 对话        │
│ (可折) │                        │  （可折为浮动抽屉）     │
└────────┴────────────────────────┴──────────────────────┘
```

- 左侧 `w-64`（可缩为 `w-16` 纯图标模式）。
- 中栏 `flex-1`，承载数据表与各功能页面。
- 右栏 `w-96`，承载 Agent 对话面板，**与 Tab 解耦、跨页面持久**。
- `<1024px` 显示警告条；`<1280px` 自动折叠右栏。
- 实现见 `src/layouts/AppLayout.tsx`，resize 监听 + `useUiStore` 状态管理。

### 2.1 栏间 Resize

`ResizableHandle` 组件提供可视分隔条拖拽，左右栏宽度写入 `uiStore` 并
持久化到 `localStorage`（由 `useUiStore` 的 `setLeftSidebarWidth` /
`setRightSidebarWidth` 处理）。约束见 `SIDEBAR_LEFT_MIN/MAX`、
`SIDEBAR_RIGHT_MIN/MAX`。

### 2.2 键盘快捷键（`useKeyboardShortcuts`）

| 快捷键 | 功能 |
|---|---|
| `Ctrl/Cmd+K` | 聚焦 AI 输入框 |
| `Ctrl/Cmd+B` | 切换左栏 |
| `Ctrl/Cmd+\` | 切换右栏 |
| `Escape` | 中断 Agent 生成，若未生成则关闭右栏 |

---

## 3. UI 组件

### 3.1 基础组件（`src/components/ui/`）

- **按钮**：扁平或微玻璃质感，无 3D 阴影。Primary 用 `--primary` 填充，
  hover 叠加 `--primary-glow` 软发光；Secondary 透明 + `--border` 描边。
- **AI Tool Call Card**（`AgentChatPanel` 内）：`bg-[var(--surface)]` +
  `rounded-md` + 1px 透明边。头部为图标 + 工具名 + 状态指示器（运行/完成/错误），
  主体可折叠。
- **Excel Table**（`src/components/excel/ExcelTable.tsx`）：
  - 表头：`text-xs uppercase tracking-wider` + `--muted` + 下边线。
  - 单元格：无垂直分隔线，水平 1px 透明分隔。
  - 选中：高亮 `1px solid var(--primary)`。

### 3.2 状态组件（Loading / Error / Empty）

**优先级**：Loading > Error > Empty > Content。

```tsx
if (isLoading)   return <TableSkeleton />;
if (error)       return <ApiErrorAlert error={error} onRetry={retry} />;
if (files.empty) return <EmptyExcelState />;
return <Content />;
```

具体规范：
- **Skeleton**：使用 `--surface` 背景（`animate-pulse`），尺寸与最终内容
  一致避免布局抖动（`TableSkeleton`、`AgentMessageSkeleton`）。
- **进度条**（`BatchProgress`）：`h-2`，`bg-primary` 填充，`transition-all
  duration-300 ease-out`，附速度与 ETA。
- **流式光标**：`inline-block w-1.5 h-4 bg-primary animate-blink`。
- **错误**：`--error` 10% 透明底 + 20% 透明边，文字用全色；必带"重试"动作。
- **空状态**：64px 灰图标 + 大标题 + 描述 + 主行动按钮，描述宽度不超过
  `max-w-sm`。

### 3.3 响应式断点

| 断点 | 行为 |
|---|---|
| `< 1024px` | 顶部黄条警告"建议使用 ≥1280px 屏幕" |
| `< 1280px` | 右栏自动折叠为可切换的浮动抽屉 |
| `≥ 1280px` | 完整三栏：64px + flex + 384px |
| `≥ 1920px` | 增加内边距，提升呼吸感 |

实现见 `AppLayout.tsx` 的 `onResize` 副作用。

---

## 4. 技术栈

### 4.1 选型

| 层 | 技术 | 用途 |
|---|---|---|
| 桌面壳 | Tauri 2.0 | 应用壳、IPC、系统 API |
| 前端 | React 19 + Vite 6 | UI 渲染 + 构建 |
| UI 库 | Ant Design 5（按需引入） + Tailwind CSS 4 | 组件 + 原子化样式 |
| 状态 | Zustand 5 | 轻量全局状态 |
| 图标 | lucide-react | 统一图标 |
| AI Agent | pi-agent SDK (`@earendil-works/pi-coding-agent` 0.78+) | 多轮对话、流式、工具调用、上下文压缩 |
| LLM | pi-ai providers + provider-map 拆分 | 9 类 API（Anthropic/OpenAI/DeepSeek/Google…），运行时 provider↔api 正确映射 |
| 网络代理 | undici 双 Dispatcher + .env | 每模型独立代理开关，EnvHttpProxyAgent / Agent 直连动态切换 |
| 后端 | Rust (stable) | Tauri Commands、Excel I/O、SQLite、Sidecar 管理 |
| Excel | calamine 0.26 + rust_xlsxwriter 0.77 | 读 + 写，纯 Rust |
| 数据库 | rusqlite 0.32（bundled） | 业务数据持久化 |
| 安全存储 | tauri-plugin-store 2 | API Key 加密 |
| 自动更新 | tauri-plugin-updater 2 | 应用内更新 |
| 文件系统 | tauri-plugin-dialog / tauri-plugin-fs 2 | 文件选择/读取 |
| Sidecar 运行时 | Node.js 20+ | pi-agent 运行环境 |

### 4.2 为什么用 pi-agent

| 能力 | 自研实现 | pi-agent |
|---|---|---|
| 多轮对话 | 自建 Session + 消息持久化 | `AgentSession` + `SessionManager` 内置 |
| 流式输出 | 手写 SSE 解析 + Tauri Events 桥 | `EventStream` push-based async iterable |
| 工具调用 | 自研调度框架 | `AgentTool` + Agent Loop 内置 |
| 上下文压缩 | 滑动窗口 + LLM 摘要 | Auto-Compaction（token 阈值 + 迭代摘要 + 分片） |
| 会话持久化 | SQLite 表 | JSONL 树状持久化 + 分支 |
| Python 执行 | 独立 Python Sidecar + JSON-RPC | `bash` 工具 + Agent Loop 自动修复 |
| 重试 / 多 Provider | 手写 | 内置指数退避 + 9 类 Provider |

收益：消除约 12 人天的 LLM 服务层开发量，获得远超自研的能力。

### 4.3 为什么 Rust 不直接处理 LLM

LLM 调用的瓶颈在网络 I/O（每次 1-10 秒），Rust 的性能优势在此场景不明显。
pi-agent 完整框架价值远超微小性能差异。

### 4.4 为什么保留 Rust Excel 处理

Excel 读写是 CPU 密集 + 内存密集操作，calamine / rust_xlsxwriter
性能显著优于 Node.js 库，且 Rust 直接操作文件系统更安全。

---

## 5. 进程与通信架构

### 5.1 三进程视图

```
┌─────────────────────────────────────────────────────────────┐
│                  Tauri 2.0 Application                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             React 前端 (WebView)                        │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │ 左栏     │  │ 中栏         │  │ 右栏             │  │  │
│  │  │ Tab 导航 │  │ 数据 / 页面  │  │ AgentChatPanel  │  │  │
│  │  └──────────┘  └──────────────┘  └────┬────────────┘  │  │
│  │              Tauri IPC / Events                       │  │
│  └─────────────────────────────────────┬──────────────────┘  │
│                                         │                    │
│  ┌──────────────────────────────────────▼─────────────────┐  │
│  │                Rust 后端 (Tauri Core)                  │  │
│  │                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │ Sidecar Mgr  │  │ Event Bridge │  │ HTTP Bridge  │  │  │
│  │  │ 进程+心跳    │  │ JSONL→Event  │  │ 127.0.0.1    │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │  │
│  │         │                 │                  │          │  │
│  │  ┌──────▼─────────────────▼──────────────────▼───────┐ │  │
│  │  │           Business Services                       │ │  │
│  │  │  Config | Prompt | Excel(calamine+xlsxwriter) |   │ │  │
│  │  │  SQLite | SecureStore (plugin-store)             │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └─────────────────────────┬──────────────────────────────┘  │
│                            │ stdin/stdout JSONL              │
│  ┌─────────────────────────▼──────────────────────────────┐  │
│  │           Node.js Sidecar (pi-agent SDK)               │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  AgentSession                                    │  │  │
│  │  │  ├── Multi-turn Conversation + Auto-Compaction  │  │  │
│  │  │  ├── Custom Tools ──HTTP──→ Rust Bridge         │  │  │
│  │  │  │   read_excel | write_excel | apply_formula    │  │  │
│  │  │  │   get_config | test_connection                │  │  │
│  │  │  │   get_prompts | save_prompt                  │  │  │
│  │  │  │   start_batch | pause_batch | get_batch_status│  │  │
│  │  │  ├── bash (built-in) → 系统 Python              │  │  │
│  │  │  └── read / write / edit (built-in)              │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  BatchRunner（独立模块，复用 pi-ai Provider）     │  │  │
│  │  │  ├── 逐行 LLM 调用                               │  │  │
│  │  │  ├── 断点续传（checkpoint.json）                  │  │  │
│  │  │  ├── 暂停 / 恢复 / 中止                          │  │  │
│  │  │  └── 指数退避 3 次重试                           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 通信数据流

| 路径 | 协议 | 用途 |
|---|---|---|
| React → Rust | `@tauri-apps/api/core::invoke` | 命令调用 |
| Rust → React | Tauri Events（`emit`） | 流式、状态、错误 |
| Rust → Sidecar | stdin JSONL | 发送消息、steer、batch 命令 |
| Sidecar → Rust | stdout JSONL | Agent 事件、心跳 |
| Sidecar → Rust | HTTP `127.0.0.1:<port>` | Agent 工具调用数据服务 |
| Rust → DB | rusqlite | 业务数据 |
| API Key | `tauri-plugin-store` | 加密独立存储 |

### 5.3 Sidecar 进程管理（`SidecarManager`）

`src-tauri/src/services/sidecar_manager.rs`：

- `start(app)`：调用 `resolve_agent_entry(&app)` 查找 agent 入口脚本 →
  `node` 启动子进程 → `stdin` / `stdout` 管道 → 启动 stdout reader + heartbeat monitor。
  `resolve_agent_entry` 优先查找 dev 路径（`project_root/src-agent/dist/main.js`），
  若不存在则退到生产模式（`resource_dir/src-agent/dist/main.js`），
  避免 dev 模式下 `resource_dir()` 返回 `target/debug/` 导致 `\\?\` 前缀路径被 Node.js 误解析。
- `set_bridge_port(port)`：在启动前由 `lib.rs` 注入 HTTP Bridge 端口，
  通过 `--bridge-port` 参数传给 Node.js。
- `set_db_dir(dir)`：在启动前由 `lib.rs` 注入 DB 数据目录（`app.path().app_data_dir()`），
  通过 `--db-dir` 参数传给 Node.js，作为 Agent 的默认工作目录和 `.pi/skills/` 扫描基准。
- `send_user_message(content)`：写 `{"type":"user_message","content":...}` 到 stdin。
- `steer(context)`：写 `{"type":"steer","context":...}`，用于上下文注入。
- `send_set_cwd(cwd)`：写 `{"type":"set_cwd","cwd":...}`，动态切换 Agent 工作目录。
- `stop_stream()` / `restart(app)` / `status()`。
- **超时保护**：`SEND_TIMEOUT = 3s`（stdin 写入），`HEARTBEAT_TIMEOUT = 15s`。
- **心跳监控**：每 5 秒 tick，超过 15 秒无 stdout 即发 `sidecar-dead` 事件。
- **空行过滤**：stdout reader 和 stdin reader 均跳过空行（管道关闭时产生），
  避免 `JSON.parse('')` / `serde_json::from_str("")` 报 "expected value at line 1 column 1" 错误。

### 5.4 HTTP Bridge Server（`BridgeServer`）

`src-tauri/src/services/bridge_server.rs`：

- 启动时 `TcpListener::bind("127.0.0.1:0")` 申请动态端口，把端口号
  注入 `SidecarManager` 供后续启动 Sidecar。
- 接收 HTTP POST 请求，路径形如 `/api/excel/info`、`/api/config/default` 等，
  内部调用相应服务并返回 JSON。
- 启动顺序见 `lib.rs`：先 Bridge → 再 Sidecar（带 `--bridge-port`）。

### 5.5 协议事件清单（精简版）

详细见 `docs/PROTOCOL.md`。Sidecar stdout 主要事件：

| 事件 | Tauri Event | 用途 |
|---|---|---|
| `sidecar_ready` | `sidecar-ready` | Sidecar 启动完成 |
| `heartbeat` | `sidecar-heartbeat` | 5s 一次心跳 |
| `agent_delta` | `agent-event` | 流式文本片段 |
| `agent_done` | `agent-event` | 一轮回复结束 |
| `agent_tool_start` / `agent_tool_end` | `agent-event` | 工具调用 |
| `agent_error` | `agent-event` | 错误 |
| `batch_progress` | `batch-progress` | 批量进度 |
| `batch_row_complete` | `batch-row-complete` | 单行完成 |
| `batch_done` | `batch-done` | 批量完成 |
| `batch_error` | `batch-error` | 批量错误 |
| `batch_paused` | `batch-paused` | 暂停 |
| `cwd_changed` | `agent-event` | Agent 工作目录已变更 |

---

## 6. 目录与模块

```
ai-sheet/
├── DESIGN.md                      ← 本文档
├── PRODUCT.md                     ← 产品定位
├── AGENT.md                       ← 编码行为准则
├── docs/
│   ├── HANDOFF.md                 ← 下一阶段开发交接
│   ├── PROTOCOL.md                ← 通信协议细节
│   ├── source_code/               ← 旧版 Python 源码归档（仅参考）
│   ├── multi-turn-conversation-design.md  ← 历史方案稿
│   ├── upgrade-plan-tauri-react.md        ← 历史方案稿
│   ├── upgrade-summary.md                ← 历史方案稿
│   ├── upgrade-enhancements-summary.md    ← 历史方案稿
│   ├── upgrade-plan-additions.md         ← 历史方案稿
│   └── precious-snuggling-avalanche.md   ← 历史方案稿
│
├── src-tauri/                     ← Rust 后端
│   ├── Cargo.toml                 （calamine / rust_xlsxwriter / rusqlite /
│   │                               tauri / 4 个 tauri-plugin）
│   ├── tauri.conf.json            （updater + store 配置）
│   ├── capabilities/default.json  （插件权限）
│   └── src/
│       ├── main.rs / lib.rs       （Tauri Builder、命令注册、启动顺序）
│       ├── error.rs               （AppError 枚举 + Serialize）
│       ├── commands/              （IPC 命令层）
│       │   ├── config.rs          （get_active / get_fallback / user CRUD）
│       │   ├── excel.rs           （info / columns / sample / column_data /
│       │   │                       write / apply_formula / processing_status）
│       │   ├── prompt.rs          （CRUD via SQLite）
│       │   ├── formula_cache.rs   （历史查询 / 保存 / touch）
│       │   ├── sidecar.rs         （status / send / steer / set_cwd / stop / restart）
│       │   ├── skill.rs           （list/read/read_file/list_files/create/delete/
│       │   │                       update_file/delete_file/create_file/import_folder——
│       │   │                       v9 起移除 project_root 参数，改用 app.path().app_data_dir()）
│       │   └── system.rs          （get_app_status / get_app_data_dir）
│       ├── services/              （业务服务）
│       │   ├── excel_service.rs   （calamine + rust_xlsxwriter 读写）
│       │   ├── config_service.rs  （默认模型 + 用户模型 + fallback 链）
│       │   ├── sidecar_manager.rs （Node.js 进程管理 + 心跳 + 超时 + --db-dir + send_set_cwd）
│       │   └── bridge_server.rs   （127.0.0.1 动态端口 HTTP 服务）
│       ├── db/                    （SQLite 持久化）
│       │   ├── mod.rs             （Database、WAL、busy_timeout）
│       │   ├── migrations.rs      （5 张表 schema）
│       │   ├── models_repo.rs
│       │   ├── prompts_repo.rs
│       │   └── formula_cache_repo.rs
│       └── models/                （DTO 序列化结构）
│           ├── config.rs / agent.rs / prompt.rs
│           ├── excel.rs           （ExcelInfo / ColumnData / WriteResult
│           │                       / ApplyFormulaRequest / ProcessingStatus）
│           ├── skill.rs           （SkillInfo / SkillDetail / SkillInput / FileNode）
│           └── formula_cache.rs
│
├── src-agent/                     ← Node.js Sidecar
│   ├── package.json               （@earendil-works/pi-coding-agent /
│   │                               pi-ai / dotenv / @sinclair/typebox）
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts                （stdin JSONL 路由 + 启动 AgentSession + 双 Dispatcher + .env 加载 + --db-dir 解析 + set_cwd 处理）
│       ├── agent.ts               （createSheetAgent：注册自定义工具 + provider-map 拆分 + ResourceLoader 自动发现技能 + agentsFilesOverride 注入 AGENTS.md）
│       ├── bridge.ts              （HTTP BridgeClient，30s AbortSignal 超时）
│       ├── protocol.ts            （SidecarCommand / SidecarEvent 类型）
│       ├── proxy-state.ts         （每模型代理开关运行时状态：getUseProxy / setUseProxy）
│       ├── provider-map.ts        （providerType → { provider, api } 映射，运行时正确拆分）
│       ├── prompts/system.ts      （占位模块，静态规则已迁移至 .pi/AGENTS.md，动态上下文由 steer() 注入）
│       ├── tools/
│       │   ├── mod.ts             （createCustomTools 聚合）
│       │   ├── excel-tools.ts     （read_excel / write_excel / apply_formula）
│       │   ├── config-tools.ts    （get_config / test_connection）
│       │   ├── prompt-tools.ts    （get_prompts / save_prompt）
│       │   └── batch-tools.ts     （start_batch / pause_batch / get_batch_status）
│       └── batch/
│           ├── runner.ts          （BatchRunner：逐行 + 暂停/恢复 + 重试 + 断点）
│           └── progress.ts        （ProgressTracker：速度、ETA、状态）
│
└── src/                           ← React 前端

├── .env                           ← 代理配置（HTTP_PROXY/HTTPS_PROXY，不入库）
├── .env.example                   ← 代理配置模板（入库）
├── .pi/                           ← 捆绑资源，首次运行复制到 app_data_dir（§8.2.1）
│   ├── SYSTEM.md                  ← Agent 身份定义，通过 systemPromptOverride 注入
│   ├── AGENTS.md                  ← 顶层基础原则，通过 agentsFilesOverride 注入
│   └── skills/                    ← 技能目录（DefaultResourceLoader 自动发现 + 首次运行复制）
│       └── python-processing/
│           └── SKILL.md           ← 默认技能
│
└── src/                           ← React 前端
    ├── main.tsx                   （挂载 + ErrorBoundary 包裹）
    ├── App.tsx                    （Provider + AppLayout）
    ├── layouts/
    │   └── AppLayout.tsx          （三栏布局 + Resize + 响应式）
    ├── pages/
    │   ├── DataPage.tsx           （上传 + Sheet + 列选择 + 预览）
    │   ├── FormulaPage.tsx        （公式输入 + 预览 + 应用 + 历史）
    │   ├── AiPage.tsx             （AI 子导航：提示词 / LLM / Python）
    │   ├── LLMProcessingPage.tsx  （批量处理 UI + 进度 + 日志 + 控制）
    │   ├── PythonProcessingPage.tsx（脚本编辑器 + 执行 + 输出）
    │   ├── ConfigPage.tsx         （模型 CRUD + 测试连接 + 内置模型展示）
    │   ├── PromptsPage.tsx        （提示词 CRUD + 搜索）
    │   └── SkillsPage.tsx         （技能列表 + 文件树 + 内容预览 + 新建/删除）
    ├── components/
    │   ├── agent/                 （AgentChatPanel / MessageList / AgentInput）
    │   ├── excel/                 （FileDropZone / ExcelTable / ColumnSelector）
    │   └── ui/                    （EmptyState / ErrorBoundary / ErrorState
    │                                / LoadingState）
    ├── stores/                    （Zustand）
    │   ├── agentStore.ts          （消息流 + 状态机）
    │   ├── excelStore.ts          （文件/Sheet/列选择 + 预览 + 上下文通知）
    │   ├── processingStore.ts     （批量进度 + 事件订阅 + 控制）
    │   ├── configStore.ts         （模型 + secureStore 协调）
    │   ├── promptStore.ts         （提示词 CRUD + 搜索）
    │   ├── skillStore.ts          （技能列表 + 文件树 + 详情 + 选中文件）
    │   └── uiStore.ts             （Tab、栏宽、折叠、主题）
    ├── hooks/
    │   └── useKeyboardShortcuts.ts
    ├── services/
    │   ├── tauri.ts               （invoke / listen 封装）
    │   └── secureStore.ts         （plugin-store 包装 API Key 加密）
    ├── types/                     （TS DTO 镜像 Rust models）
    └── styles/globals.css         （CSS 变量、字体、基础）
```

---

## 7. 数据模型

### 7.1 SQLite Schema（v6 迁移）

迁移文件 `src-tauri/src/db/migrations.rs` 集中存放，每条 SQL `IF NOT EXISTS`：

```sql
-- schema_version
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- v2: models（用户配置）
CREATE TABLE models (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    api_key       TEXT NOT NULL DEFAULT '',
    base_url      TEXT NOT NULL,
    model_id      TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'openai-completions',
    is_default    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- v3: prompts
CREATE TABLE prompts (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    content    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT '',
    is_system  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- v4: formula_cache
CREATE TABLE formula_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement TEXT NOT NULL,
    columns_key TEXT NOT NULL,
    formula     TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    model_id    TEXT NOT NULL DEFAULT '',
    accessed_at TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- v5: settings
CREATE TABLE settings (
    key        TEXT NOT NULL PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- v6: per-model proxy toggle
ALTER TABLE models ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 1;
```

> **API Key 不入库**。存储策略详见 §10.1。

### 7.2 模型配置

LLM 配置全部由用户手动添加，无内置免费模型。用户通过配置页面新增/编辑/删除模型配置。

当前使用的模型由前端 `set_active_model` 写入进程内存的 `ActiveModel` 并持久化到 `settings` 表，
HTTP Bridge `/api/config/default` 读取后下发给 sidecar。

**Provider-Map 拆分**：用户配置的 `providerType` 字段同时承载了 provider 身份和 API 协议信息
（如 `'deepseek'` 既是 provider 又使用 `'openai-completions'` 协议）。`src-agent/src/provider-map.ts`
在运行时将 `providerType` 正确拆分为 `provider` + `api`，确保 API key 查找和 SDK 选择均正确。

**每模型代理开关**：`ModelConfig` 和 `ActiveModel` 新增 `use_proxy: bool` 字段，默认 `true`。
Sidecar 使用双 Dispatcher 架构：`EnvHttpProxyAgent`（走代理）+ `Agent`（直连），
每次 LLM 调用前根据模型的 `useProxy` 设置同步到 `proxy-state.ts`，
fetch override 据此选择 dispatcher。代理地址从项目根目录 `.env` 文件加载（`HTTP_PROXY`/`HTTPS_PROXY`）。

**旧数据兼容**：Rust 端 `use_proxy` 字段使用 `#[serde(default = "default_use_proxy")]`，
确保从 settings 表反序列化旧 JSON 时不因缺少字段而崩溃。

### 7.3 pi-agent 会话持久化

对话由 `SessionManager.inMemory()` 管理（**当前未启用文件持久化**，
这是已知缺口）。设计上是 JSONL 树状结构，存储路径
`~/.ai-sheet/sessions/<session-id>.jsonl`，但需要切换 SessionManager 实现。

### 7.4 关键 Rust DTO

`models/excel.rs`：
- `ExcelInfo { file_path, file_name, file_size, sheets: Vec<SheetMeta> }`
- `SheetMeta { name, row_count, column_count }`
- `ColumnInfo { name, index }`
- `SampleData { columns, rows: Vec<Vec<String>>, total_rows, sample_size }`
- `ColumnData { columns, rows, total_rows }`
- `WriteResultsRequest { path, sheet, column, results: Vec<WriteResult> }`
- `ApplyFormulaRequest { path, sheet, column, formula }`
- `ProcessingStatus { total_rows, processed_rows, result_column }`

`models/agent.rs`：
- `AgentStatus { ready, is_streaming, last_heartbeat_age_secs, message }`

`models/config.rs`：
- `ModelConfig { id, name, api_key, base_url, model_id, provider_type, use_proxy }`
- `ActiveModel { name, provider_type, model_id, api_key, base_url, use_proxy }`

> `use_proxy` 字段使用 `#[serde(default = "default_use_proxy")]`（默认 `true`），
> 确保反序列化旧数据时兼容。

`models/skill.rs`：
- `SkillInfo { name, description }`
- `SkillDetail { name, description, content, raw }`
- `SkillInput { name, description, content }`
- `FileNode { name, path, is_dir, children: Vec<FileNode> }`

### 7.5 关键 TypeScript 类型

`types/agent.ts`：
- `AgentMessage { id, role, content, isStreaming?, displayContent?, fullContent?, toolCalls? }`
- `AgentContext { currentTab, loadedFiles, selectedColumns, sampleDataPreview?, cwd? }`
- `AgentStatus`
- `SidecarEvent`（判别联合，详见 `docs/PROTOCOL.md`）

`types/config.ts`：
- `ModelConfig { id?, name, apiKey, baseUrl, modelId, providerType, useProxy }`

`types/excel.ts` 镜像 Rust DTO 并补全前端视图层字段
（如 `ExcelFileInfo { path, name, size }`、`FileSelection` 聚合）。

`types/skill.ts`：
- `SkillInfo { name, description }`
- `SkillDetail { name, description, content, raw }`
- `SkillInput { name, description, content }`
- `FileNode { name, path, is_dir, children }`

---

## 8. 核心机制

### 8.1 三栏与上下文联动

**上下文注入**：

```
React (ExcelStore)
   │ selectSheets / selectColumns / addFile
   ▼
notifyContextChange()
   │ 构造 AgentContext（含 cwd）
   ▼
invoke('steer_agent', { context })
   │
   ▼
Rust: sidecar_manager.steer(contextJson)
   │ 写 stdin: {"type":"steer","context":{...}}
   ▼
Node.js: session.steer(text) → 下轮生效
```

**工作目录切换**：

```
React (ExcelStore.addFile)
   │ 首次加载 Excel，提取父目录
   ▼
invoke('set_agent_cwd', { cwd })
   │
   ▼
Rust: sidecar_manager.send_set_cwd(cwd)
   │ 写 stdin: {"type":"set_cwd","cwd":"..."}
   ▼
Node.js: currentCwd = cwd → session.steer(目录变更通知)
   ▼
emit('cwd_changed')
```

### 8.2 资源捆绑、首次运行复制与动态工作目录

#### 8.2.1 资源捆绑与首次运行复制

**问题**：`.pi/` 目录（含 AGENTS.md、SYSTEM.md、skills/）和 `src-agent/dist/` 需要在
构建时打包到应用资源中，并在首次启动时复制到 `app_data_dir`，使 agent 和 Rust 后端
能在运行时从已知固定路径读取。开发模式下则直接从项目源码目录读取。

**捆绑配置**（`src-tauri/tauri.conf.json:30-31`）：

```json
"resources": {
  "../.pi/": ".pi/",
}
```

`../.pi/` 相对于 `src-tauri/`，即项目根目录的 `.pi/` 整个目录树被捆绑为 Tauri 资源。

**首次运行复制逻辑**（`src-tauri/src/lib.rs:88-124`）：

```rust
if let Ok(data_dir) = app.path().app_data_dir() {
    let pi_dest = data_dir.join(".pi");
    if !pi_dest.exists() {  // 仅当目标不存在时才复制
        let pi_src = None::<std::path::PathBuf>
            // 生产模式：从捆绑资源目录
            .into_iter()
            .chain(app.path().resource_dir().ok().map(|d| d.join(".pi")))
            // 开发模式：从项目根目录
            .chain(std::env::current_dir().ok().and_then(|cwd| {
                let root = if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                    cwd.parent()?.to_path_buf()
                } else { cwd };
                Some(root.join(".pi"))
            }))
            .find(|p| p.exists());
        if let Some(src) = pi_src {
            copy_dir_all(&src, &pi_dest);
        }
    }
}
```

**复制行为总结**：

| 场景 | 源路径 | 目标路径 | 触发条件 |
|------|--------|----------|----------|
| 生产首次运行 | `resource_dir/.pi/`（捆绑资源） | `app_data_dir/.pi/` | 目标不存在 |
| 开发首次运行 | `项目根/.pi/`（源码目录） | `app_data_dir/.pi/` | 目标不存在 |
| 后续运行（含 `npm run tauri:dev`） | — | — | **跳过**（目标已存在） |

> **关键注意**：`if !pi_dest.exists()` 意味着后续 `npm run tauri:dev` **不会**更新
> `app_data_dir/.pi/`。修改 `.pi/` 下的文件后，需手动删除 `app_data_dir/.pi/` 再重启，
> 或直接覆盖目标文件，变更才能生效。

**`.pi/` 目录内容**：

```
.pi/
├── SYSTEM.md                  ← Agent 身份定义（通过 systemPromptOverride 注入）
├── AGENTS.md                  ← 顶层基础原则（通过 agentsFilesOverride 注入）
└── skills/
    └── python-processing/
        └── SKILL.md           ← 自动发现
```

#### 8.2.2 动态工作目录

**问题**：pi agent 的 `cwd` 决定了内置工具（bash/read/write/edit）的相对路径解析基准，
也控制了 `DefaultResourceLoader` 对 `.pi/skills/` 等项目资源的目录扫描。
原始实现固定为 `process.cwd()`（项目代码路径），导致工具操作基于代码目录而非用户数据目录。

**解决方案**：两层策略——

| 层 | 机制 | 作用 |
|---|---|---|
| 实际 cwd | `createAgentSession({ cwd: initialCwd })` | 决定内置工具的路径解析基准 |
| 逻辑 cwd | `session.steer()` 通知 + `AgentContext.cwd` 字段 | 告知 agent 当前工作目录，引导其使用正确路径 |

**默认 cwd**：Tauri app_data 目录（DB 数据库文件所在目录），通过 `--db-dir` 参数传入 sidecar。
三端路径统一：Rust skill 命令、Agent `DefaultResourceLoader`、前端 `SkillsPage` 均以此为基准。
`.pi/` 目录由首次运行复制机制（§8.2.1）从捆绑资源拷贝到 `app_data_dir/.pi/`。

**Excel 加载切换**：前端 `addFile` 检测到首个 Excel 文件时，提取其父目录，
通过 `set_agent_cwd` → Rust → sidecar `set_cwd` 命令更新 `currentCwd`，
并 `session.steer()` 通知 agent 目录已变更。多个 Excel 以第一个为准。

#### 8.2.3 System Prompt 三层注入

`.pi/` 下的三个源文件在 agent 启动时分别通过不同机制加载，合并为最终 system prompt：

| 文件 | 加载机制 | 在 System Prompt 中的位置 | 用途 |
|------|----------|---------------------------|------|
| `SYSTEM.md` | `systemPromptOverride` 显式读 `join(initialCwd, '.pi', 'SYSTEM.md')` | `customPrompt`（最顶层） | Agent 身份："你是 AI-Sheet..." |
| `AGENTS.md` | `agentsFilesOverride` + `DefaultResourceLoader` 自动向上遍历 | `<project_context>` | 核心原则、Excel 规则、交互规则 |
| `skills/*/SKILL.md` | `DefaultResourceLoader` 自动从 `{cwd}/.pi/skills/` 发现 | `<available_skills>` | 技能详情（Python 处理流程等） |

**代码实现**（`src-agent/src/agent.ts`）：

```ts
// 从 .pi/ 目录显式加载 AGENTS.md 和 SYSTEM.md（与动态 cwd 解耦）
const piDir = join(initialCwd, '.pi');
const agentsMdPath = join(piDir, 'AGENTS.md');
const systemMdPath = join(piDir, 'SYSTEM.md');

const loader = new DefaultResourceLoader({
  cwd: initialCwd,
  agentDir: getAgentDir(),
  systemPromptOverride: () => {
    try {
      return readFileSync(systemMdPath, 'utf-8');
    } catch {
      return undefined; // 回退 pi 默认身份
    }
  },
  agentsFilesOverride: (current) => {
    try {
      const content = readFileSync(agentsMdPath, 'utf-8');
      return {
        agentsFiles: [...current.agentsFiles, { path: agentsMdPath, content }],
      };
    } catch {
      return current; // 文件缺失时优雅降级
    }
  },
});
await loader.reload();
```

`initialCwd` 由 `main.ts` 从 `--db-dir` 参数解析，值为 Tauri `app_data_dir()`。
所有 `.pi/` 文件均由首次运行复制机制（§8.2.1）从捆绑资源拷贝到 `app_data_dir/.pi/`，
因此 agent 侧直接读 `join(initialCwd, '.pi', ...)` 即可，不再依赖 `__dirname` 相对路径。

**`systemPromptOverride` vs `agentsFilesOverride` 对比**：

| 回调 | 输入 | 输出 | 覆盖目标 |
|------|------|------|----------|
| `systemPromptOverride(basePrompt)` | 自动发现的 SYSTEM.md 内容 或 `undefined` | 返回字符串替换 `customPrompt`；返回 `undefined` 回退 pi 默认 | Pi 默认或自动发现的身份层 |
| `agentsFilesOverride(current)` | `{ agentsFiles: [...] }`（含自动向上遍历结果） | `{ agentsFiles: [...] }` 追加或替换 | `<project_context>` 列表 |

#### 8.2.4 技能自动发现

`DefaultResourceLoader` 自动扫描 `{cwd}/.pi/skills/*/SKILL.md`，
所有技能目录均被识别并注入 agent 可用列表。无需硬编码或 `skillsOverride` 回调。
运行时行为一致：启动时仅注入 name + description 元数据到系统提示词，
agent 自主判断是否需要 read 加载完整 SKILL.md 内容后执行。

#### 8.2.5 Compaction 自动上下文压缩

`SettingsManager.inMemory()` 默认 `compaction.enabled: true`
（`settings-manager.js:455`，默认值见文档 `settings.md:75`），
会在长对话中自动对早期消息做摘要压缩，减少 token 消耗。
项目代码未设置 `compaction` 字段，因此使用默认启用状态。

#### 8.2.6 技能管理 UI

前端提供「技能管理」Tab（SkillsPage），三栏布局：
左侧技能列表（搜索/新建/删除）→ 中间文件树（递归浏览技能目录内所有文件和子目录）→
右侧内容预览（Markdown 预览/原文切换、代码文件等宽显示）。

后端通过 10 个 Rust Tauri Commands 提供技能 CRUD 和文件浏览/编辑能力（v9 起移除 `project_root` 参数，改用 `app.path().app_data_dir()`）：

| 命令 | 说明 |
|------|------|
| `list_skills(app)` | 列出 `app_data_dir/.pi/skills/` 下所有技能（解析 SKILL.md frontmatter） |
| `read_skill(app, name)` | 读取指定技能的 SKILL.md 全文 |
| `read_skill_file(app, name, file_path)` | 读取技能目录下任意子文件（含路径遍历安全检查） |
| `list_skill_files(app, name)` | 递归读取技能目录结构，返回 `FileNode` 树 |
| `create_skill(app, input)` | 创建技能目录 + SKILL.md（自动生成 frontmatter） |
| `delete_skill(app, name)` | 删除技能整个目录（含安全检查） |
| `update_skill_file(app, name, file_path, content)` | 更新技能目录下指定文件内容 |
| `delete_skill_file(app, name, file_path)` | 删除技能目录下指定文件或子目录 |
| `create_skill_file(app, name, file_path, content)` | 在技能目录下新建子文件（自动创建父目录） |
| `import_skill_from_folder(app, source_path, skill_name?)` | 从本地文件夹导入，递归复制到 `app_data_dir/.pi/skills/` 下 |

**前端交互**：
- **编辑**：任何文件点击"编辑"后切换为 textarea，保存调用 `update_skill_file`
- **新增子文件**：文件树顶部"+"按钮，输入相对路径（如 `scripts/run.py`），自动创建父目录
- **删除文件/目录**：每个文件旁的删除按钮，SKILL.md 编辑/删除需谨慎（影响技能发现）
- **从本地导入**：通过 Tauri `dialog` 插件选择文件夹，递归复制为技能目录；若目标无 SKILL.md 则自动生成
- **项目根路径**：v9 起不再通过 `import.meta.url` 推断项目根路径（该方式在 Tauri 运行时不可靠），
  所有 Rust 命令已不再需要传入 `projectRoot` 参数

**数据模型**：

```rust
struct SkillInfo { name: String, description: String }
struct SkillDetail { name: String, description: String, content: String, raw: String }
struct SkillInput { name: String, description: String, content: String }
struct FileNode { name: String, path: String, is_dir: bool, children: Vec<FileNode> }
```

**安全约束**：
- 技能名称仅允许小写字母、数字、连字符
- `read_skill_file` 和 `delete_skill` 均做 canonicalize 后的路径前缀校验，防止路径遍历
- 删除操作前端需 `window.confirm` 二次确认

### 8.3 模型解析

Sidecar 从 Bridge 获取默认模型配置后，通过 `provider-map` 模块正确拆分 `providerType`
为 `provider` + `api`，再注册到 `ModelRegistry`：

```ts
// src-agent/src/agent.ts
import { buildModel } from './provider-map.js';
import { setUseProxy } from './proxy-state.js';

const defaultModel = await bridge.getDefaultModel();

if (defaultModel) {
  // 同步代理状态
  setUseProxy(defaultModel.useProxy ?? true);

  // provider-map 正确拆分：'deepseek' → { provider: 'deepseek', api: 'openai-completions' }
  const model = buildModel(defaultModel);

  // 注册 provider（使用正确的 provider 名，而非 providerType）
  modelRegistry.registerProvider(model.provider, {
    api: model.api,
    apiKey: defaultModel.apiKey,
    baseUrl: defaultModel.baseUrl,
    models: [model],
  } as any);
}
```

**Provider-Map 核心映射**：

| 用户配置 `providerType` | 解析后 `provider` | 解析后 `api` |
|---|---|---|
| `'openai-completions'` | `'openai'` | `'openai-completions'` |
| `'anthropic-messages'` | `'anthropic'` | `'anthropic-messages'` |
| `'deepseek'` | `'deepseek'` | `'openai-completions'` |
| `'mistral-conversations'` | `'mistral'` | `'mistral-conversations'` |
| `'google-generative-ai'` | `'google'` | `'google-generative-ai'` |

> **关键**：`provider` 用于 API key 查找（`authStorage.getApiKey(model.provider)`），
> `api` 决定请求格式和 SDK 选择。二者混淆会导致 "No API provider registered for api: deepseek"
> 或 API key 查找失败。

> **当前实装说明**：模型解析失败时 `model = undefined`，Agent 仍可启动但
> 会话处于无模型状态，需用户先在"配置管理"页配置默认模型。

### 8.4 批量处理双触发

```
┌────────────────────────┐    ┌────────────────────────┐
│ 中栏 LLM 批量页面       │    │ 右栏 Agent 工具         │
│ (直接执行)              │    │ start_batch（Agent 辅助）│
└──────────┬─────────────┘    └──────────┬──────────────┘
           │                             │
           ▼                             ▼
  invoke('send_agent_message', JSON.stringify({type:'batch_start',...}))
           │                             │
           └──────────────┬──────────────┘
                          ▼
   Rust: sidecar.send_batch_command('batch_start', {params})
                          ▼
   Node.js: handleBatchStart → setUseProxy(params.useProxy) → new BatchRunner().run(...)
                          ▼
   runner._processRowWithRetry (3 次指数退避)
                          ▼
   bridge.post('/api/excel/write', {row, value})
                          ▼
   runner 触发 onProgress / onRowComplete
                          ▼
   main.ts → emit('batch_progress' / 'batch_row_complete' / 'batch_done')
                          ▼
   Rust Event Bridge → Tauri Events → React (processingStore)
```

`processingStore.subscribeToEvents()` 监听 `batch-progress` /
`batch-row-complete` / `batch-done` / `batch-error` 事件，实时更新
`batchProgress` 和 `batchLogs`。

### 8.5 断点续传

`BatchRunner` 在每次写结果成功后：
1. 写 `checkpoint.json` 到 `cwd/.batch-checkpoints/`，记录 `processedCount`。
2. 启动时读取该文件，从 `processedCount` 继续。
3. `get_processing_status` 二次校验，跳过已存在结果的行（双保险）。

### 8.6 公式应用

`ExcelService::apply_formula` 读取 → 写入新文件 → `rename` 替换：
- `{}` 占位符替换为行号（**注意**：当前实现中 `formula.replace("{}", &(excel_row + 1).to_string())` 把 `{}` 替换为 `excel_row + 1`；从使用方传入 `=A{}+B{}` 时会按行展开为 `=A2+B2`）。
- 临时文件 `.tmp` 在原文件同目录，写入成功后 `rename`。

### 8.7 提示词库

- `promptStore` 通过 Tauri IPC 走 SQLite。
- 公式页面在应用成功后自动 `saveFormulaCache()`。
- LLM 页面从 promptStore 拉取列表（下拉选择）。

### 8.8 快捷按钮触发

右栏 AgentChatPanel 底部输入框上方新增 <QuickActionBar />，提供两
个固定按钮：「公式生成」「提示词生成」。点击后**走常规 Agent 消息路径**，
构建的完整 prompt 作为 user message 发送到 `session.prompt()`，自动纳入
对话历史：

```
QuickActionBar 按钮点击
   │
   ▼
前端构建完整 prompt（模板 + header + Excel 上下文）
   │  agentQuickActions.ts: findPromptByName + buildDisplaySummary + buildDirectPrompt
   ▼
agentStore.sendMessage(input, displaySummary, fullPrompt)
   │  → 添加 user message（displayContent = 摘要, fullContent = 完整 prompt）
   │  → 走常规 sendAgentMessage(content = fullPrompt)
   ▼
invoke('send_agent_message', { content })
   │
   ▼
Rust → stdin → Node session.prompt() → AgentSession 处理
   │  （含工具调用、多轮历史、Auto-Compaction）
   ▼
agent_delta/done → agentStore.handleEvent (按 msg- 前缀匹配)
```

**关键设计**：
- prompt 构建全在前端（`agentQuickActions.ts`），与正常对话共享 AgentSession。
- 用户消息的 `displayContent` 显示摘要（如 `Excel公式生成 · 「计算利润率」 · Sheet1 · 列: A(销售额)...`），
  `fullContent` 保存完整 prompt 可供"展开"查看。
- 模板从 `promptStore` 取（按 `name` 精确匹配 `Excel公式生成` / `提示词生成`）。
- Excel 上下文优先用 `agentStore.loadedContext`，仅 sample preview 从 `excelStore` 补。
- `{}` 占位符表示行号替换（`apply_formula` 实际行为）。
- `stop` 命令：调用 `session.abort()` 中断当前 Agent 运行。支持在 LLM 调用、工具执行等
  任何阶段中断，中断后前端自动进入就绪状态。
- 与原 Direct LLM 方案的区别：
  - 不再有独立的 `directStreamingRequestId` / `direct-` 前缀路由（已删除）。
  - 快捷消息纳入对话历史，后续提问可引用此前生成的公式或提示词。
  - BatchRunner 的独立 `stream()` 调用不受此项变更影响。

---

## 9. 双模式设计原则

每个核心功能同时支持**直接执行**和 **Agent 辅助**两种模式。

| 模式 | 触发 | 适用 | 位置 |
|---|---|---|---|---|---|
| 直接执行 | 中栏表单 | 已有提示词/公式的重复任务 | 中栏页面 + Rust Tauri Commands → Sidecar |
| Agent 辅助 | 右栏对话 | 首次生成、迭代优化、复杂需求 | `AgentChatPanel` + pi-agent |

> 快捷按钮（QuickActionBar）本质上是 Agent 辅助的一种快捷入口：构建标准 prompt 后作为普通用户消息发送，
> 与手动输入共享同一 AgentSession。不再视为独立模式。

**核心原则**：
- Agent 是"生成器"（首次创作、迭代优化）。
- 中栏是"执行器"（复用已有配置，批量跑任务）。
- 两者共享 Rust 数据服务和 pi-ai Provider，仅触发路径不同。

联动：
- Agent 生成提示词 → 保存到 `prompts` 表 → 中栏下拉可选。
- Agent 生成公式 → 落地到 Excel → 中栏刷新。
- 中栏批量进度 → Tauri Events → Agent 上下文感知（**当前未注入**）。

---

## 10. 安全设计

### 10.1 API Key 存储

- **不入库**：`models.api_key` 字段虽存在但写入时存空字符串。
- **加密存储**：通过 `tauri-plugin-store` 写入独立 JSON 文件
  `ai-sheet-secure.json`，键格式 `api_key:<model_name>`，由 Tauri 内部
  加密（不同平台机制不同）。
- **读取协调**：`configStore.fetchModels()` → `enrichWithApiKeys()` 调用
  `getApiKey(name)` 注入到内存中的 `ModelConfig.apiKey`。
- **删除**：`deleteModel` 时同步 `deleteApiKey(name)`。

### 10.2 Sidecar 隔离

- 独立 Node.js 进程，Rust 控制生命周期。
- HTTP Bridge 仅监听 `127.0.0.1`，端口由 OS 动态分配，启动时通过
  `--bridge-port` 注入 Sidecar。
- Python 代码通过 pi-agent `bash` 工具在系统进程执行（**当前未限制
  工作目录或命令白名单**——是已知风险点）。
- **网络代理隔离**：使用 undici 双 Dispatcher 架构，每个模型独立控制代理开关。
  启用代理时走 `EnvHttpProxyAgent`（读取 `HTTP_PROXY`/`HTTPS_PROXY`），
  关闭时走 `Agent` 直连。代理地址从 `.env` 文件加载，该文件在 `.gitignore` 中不入库。
- **管道关闭防护**：sidecar 重启（kill + 重新 spawn）时 stdin/stdout 管道关闭
  可能产生空行，两侧 reader 均做空行过滤，避免 JSON 解析错误。

### 10.3 通信超时

- **Rust → Sidecar stdin**：`SEND_TIMEOUT = 3s`。
- **Sidecar → Rust HTTP Bridge**：`AbortSignal.timeout(30_000)`。
- **心跳阈值**：`HEARTBEAT_TIMEOUT = 15s`，超过即发 `sidecar-dead` 事件。
- **网络重试**：BatchRunner 单行处理最多 3 次指数退避（`1s, 2s, 4s` 上限 8s）。
- **undici 网络超时**：`bodyTimeout = 600_000`（10 分钟，LLM 长回复保护），
  `headersTimeout = 300_000`（5 分钟，冷启动慢模型保护）。

---

## 11. 错误处理

| 层 | 策略 |
|---|---|
| Rust | `AppError` 枚举 + `Serialize` → 字符串返回前端 |
| HTTP Bridge | 错误统一 `{ "error": "..." }` JSON，HTTP 200 |
| Sidecar stdin/stdout | 错误通过 `agent_error` 事件 |
| Frontend | `ErrorBoundary` 包裹根节点；页面级 `ApiErrorAlert` 错误条 |
| Tauri Events | `sidecar-dead` / `sidecar-restarted` 触发前端恢复 UI（**当前未实现恢复 UI**） |

> **当前缺口**：`sidecar-dead` 事件已发出，但 `useAgentRecovery` 钩子和
> "AI Agent 正在重启" 提示 UI **未实现**。详见 `HANDOFF.md`。

---

## 12. 性能与无障碍

### 12.1 性能指标

| 指标 | 目标 | 实测 / 备注 |
|---|---|---|
| 冷启动 | <2s | 取决于 Sidecar 启动（Node 加载 + pi-agent 初始化） |
| Excel 1000 行读取 | <500ms | calamine 纯 Rust 性能充足 |
| AI First Token | <1s | 网络瓶颈 |
| 内存 | <200MB | Rust ~20MB + Node ~60MB + WebView ~100MB |
| 批量处理 | 10-15 行/分钟 | LLM API 主导 |

### 12.2 无障碍（WCAG AA）

- 文本对比度满足 AA（主文本 18.2:1，AAA）。
- 全键盘可达：Tab 顺序、Enter 确认、Escape 退出。
- 焦点指示器：2px `--primary` + 2px offset。
- `aria-label` 全覆盖图标按钮。
- `aria-live` 包裹流式输出和进度，错误用 `role="alert"`。
- 遵守 `prefers-reduced-motion`。

---

## 13. 迁移与历史背景

当前项目是 v1（Python Tkinter）→ v2（Rust + Tauri）升级进行时。历史脉络
记录在以下文档中，**仅作为背景参考，开发不再遵循**：

- `docs/precious-snuggling-avalanche.md`：v1 → v2 现状分析报告（旧 Python 代码盘点）
- `docs/upgrade-plan-tauri-react.md`：v2 升级总方案 v2.1（含 P0-1 ~ P0-5 审查补丁）
- `docs/upgrade-enhancements-summary.md`：上述 P0 补丁的总结
- `docs/upgrade-plan-additions.md`：API 配置降级 / 通信加固 / 状态规范 / 迁移 / 批量增强
- `docs/upgrade-summary.md`：分阶段完成清单（2026-06-06 / 06-07）
- `docs/multi-turn-conversation-design.md`：pi-agent 集成细节设计
- `docs/source_code/`：旧 Python 源码归档（`main.py`、`modules/`、`ui/`、`units/`、`config/`），新版本可参考的逻辑：
  - `llm_client.py` → 由 pi-ai 取代
  - `excel_processor.py` → 重写为 `excel_service.rs`（calamine + xlsxwriter）
  - `multi_excel_utils.py` → 拆为 `excelStore`（前端）+ `excel_service`（后端）
  - `llm_batch_processor.py` → `BatchRunner`（Node.js）
  - `python_code_processor.py` → pi-agent 对话 + `bash` 工具

---

**文档版本**：v9.0
**更新日期**：2026-06-10
**维护者**：项目工程团队
