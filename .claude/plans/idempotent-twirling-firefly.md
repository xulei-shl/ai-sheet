# AI-Sheet 第一轮编码实施计划

## Context

当前仓库主要是设计文档与旧版 Python/Tkinter 源码参考，尚未存在可运行的新版本工程骨架：没有根目录 `package.json`、`src/`、`src-tauri/`、`src-agent/`、`Cargo.toml` 等实现文件。用户要求根据 [docs/upgrade-plan-tauri-react.md](../../docs/upgrade-plan-tauri-react.md)、[docs/upgrade-plan-additions.md](../../docs/upgrade-plan-additions.md)、[DESIGN.md](../../DESIGN.md)、[PRODUCT.md](../../PRODUCT.md)、[AGENT.md](../../AGENT.md) 开始编码，并参考 [docs/source_code/](../../docs/source_code/) 旧版代码。

推荐第一轮目标不是一次性实现完整 62 天路线图，而是先交付一个可运行、可验证、可继续扩展的最小纵向切片：Tauri + React 三栏 UI、Rust IPC、内置默认模型配置、开发期 Node sidecar、heartbeat、模拟流式 Agent 回复。这样能先跑通目标三进程架构，再逐步替换为真实 pi-agent、Excel、SQLite、批处理能力。

## Recommended Approach

### 1. 建立任务跟踪与工程骨架

创建 [tasks/todo.md](../../tasks/todo.md)，记录本轮 Phase 0 bootstrap checklist 与验证结果。不要在第一轮创建过多长期规划内容，只跟踪当前可执行任务。

创建根目录前端工程文件：

- [package.json](../../package.json)
- [tsconfig.json](../../tsconfig.json)
- [vite.config.ts](../../vite.config.ts)
- [index.html](../../index.html)
- [src/main.tsx](../../src/main.tsx)
- [src/App.tsx](../../src/App.tsx)
- [src/styles/globals.css](../../src/styles/globals.css)

依赖方向：React 19、Vite 6、Ant Design 5、Tailwind CSS 4、Zustand 5、Lucide React、`@tauri-apps/api`、`@tauri-apps/cli`。Tailwind 4 使用 `@tailwindcss/vite` 插件与 `@import "tailwindcss";`，避免 Tailwind 3 写法。

### 2. 创建 Tauri 2 Rust 后端骨架

创建：

- [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml)
- [src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json)
- [src-tauri/capabilities/default.json](../../src-tauri/capabilities/default.json)
- [src-tauri/src/main.rs](../../src-tauri/src/main.rs)
- [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs)
- [src-tauri/src/error.rs](../../src-tauri/src/error.rs)
- [src-tauri/src/models/mod.rs](../../src-tauri/src/models/mod.rs)
- [src-tauri/src/models/config.rs](../../src-tauri/src/models/config.rs)
- [src-tauri/src/models/agent.rs](../../src-tauri/src/models/agent.rs)
- [src-tauri/src/services/mod.rs](../../src-tauri/src/services/mod.rs)
- [src-tauri/src/services/config_service.rs](../../src-tauri/src/services/config_service.rs)
- [src-tauri/src/services/sidecar_manager.rs](../../src-tauri/src/services/sidecar_manager.rs)
- [src-tauri/src/commands/mod.rs](../../src-tauri/src/commands/mod.rs)
- [src-tauri/src/commands/config.rs](../../src-tauri/src/commands/config.rs)
- [src-tauri/src/commands/sidecar.rs](../../src-tauri/src/commands/sidecar.rs)
- [src-tauri/src/commands/system.rs](../../src-tauri/src/commands/system.rs)

第一轮只实现最小命令：

- `get_app_status`
- `get_active_model`
- `get_agent_status`
- `send_agent_message`
- `restart_sidecar`

`config_service.rs` 先硬编码文档要求的 fallback chain：DeepSeek-V3 与 GLM-4-Flash。第一轮不做真实 API 调用、不保存 API Key、不接 SQLite；只返回当前 active model，确保“没有用户配置时仍有默认配置”的产品约束先在接口形状上成立。

复用旧代码时仅参考行为，不直接搬运：

- [docs/source_code/source_code/modules/config_manager.py](../../docs/source_code/source_code/modules/config_manager.py) 的模型配置字段、校验思路、默认配置策略。
- [docs/source_code/source_code/units/llm_client.py](../../docs/source_code/source_code/units/llm_client.py) 的连接测试与调用错误分类，后续真实 API 阶段再迁移。

### 3. 创建开发期 Node sidecar 最小协议

创建：

- [src-agent/package.json](../../src-agent/package.json)
- [src-agent/tsconfig.json](../../src-agent/tsconfig.json)
- [src-agent/src/protocol.ts](../../src-agent/src/protocol.ts)
- [src-agent/src/main.ts](../../src-agent/src/main.ts)

第一轮 sidecar 不接真实 pi-agent，只实现 JSONL stdin/stdout 协议：

- 输入：`user_message`、`ping`、后续可扩展 `steer`。
- 输出：`heartbeat`、`agent_delta`、`agent_done`、`agent_error`。

收到用户消息后，sidecar 输出模拟分片文本，验证完整链路：React → Rust command → sidecar stdin → sidecar stdout → Rust event → React streaming UI。

Rust `sidecar_manager.rs` 负责：

- 开发期启动 `node src-agent/dist/main.js`。
- 持有 stdin writer。
- 后台读取 stdout JSONL。
- heartbeat 更新 `last_heartbeat`。
- 非 heartbeat 事件通过 Tauri event 转发给前端。
- `send_agent_message` 写入 stdin 时设置短超时。
- 超过 15 秒无 heartbeat 时标记 offline，并 emit `sidecar-dead`。

### 4. 实现 React 三栏 App Shell 与最小 Agent 面板

创建：

- [src/layouts/AppLayout.tsx](../../src/layouts/AppLayout.tsx)
- [src/components/agent/AgentChatPanel.tsx](../../src/components/agent/AgentChatPanel.tsx)
- [src/components/agent/MessageList.tsx](../../src/components/agent/MessageList.tsx)
- [src/components/agent/AgentInput.tsx](../../src/components/agent/AgentInput.tsx)
- [src/components/ui/EmptyState.tsx](../../src/components/ui/EmptyState.tsx)
- [src/components/ui/LoadingState.tsx](../../src/components/ui/LoadingState.tsx)
- [src/components/ui/ErrorState.tsx](../../src/components/ui/ErrorState.tsx)
- [src/stores/agentStore.ts](../../src/stores/agentStore.ts)
- [src/stores/uiStore.ts](../../src/stores/uiStore.ts)
- [src/services/tauri.ts](../../src/services/tauri.ts)
- [src/types/agent.ts](../../src/types/agent.ts)
- [src/types/config.ts](../../src/types/config.ts)

UI 要遵循 [DESIGN.md](../../DESIGN.md)：克制黑白灰、1px 边框、Aurora Purple 仅用于主交互和 AI 状态。布局为：左导航、中间数据区、右侧 Agent。第一轮不引入 React Router，用 Zustand 保存当前 tab 即可，降低复杂度。

中栏先显示 Excel 空状态。右栏支持：

- 展示 sidecar online/offline 状态。
- 输入消息。
- 显示用户消息。
- 监听 `agent-event` 并追加模拟流式 assistant 文本。
- `sidecar-dead` 时显示错误提示与“重连”按钮。
- 动态内容使用 `aria-live="polite"`，错误区域使用 `role="alert"`。

所有 Tauri `invoke` 与 `listen` 封装在 [src/services/tauri.ts](../../src/services/tauri.ts)，组件不直接散落 IPC 调用。

### 5. 保持第一轮边界清晰

第一轮明确不做：

- 不接入真实 pi-agent。
- 不做真实 LLM API 调用。
- 不保存 API Key。
- 不做 SQLite migrations。
- 不做 Excel 读写。
- 不做批量处理。
- 不做自动更新与安装包。
- 不做完整响应式抽屉。
- 不做旧 Python 数据自动迁移。

这些功能放到第二轮之后。第一轮只保证架构链路、UI骨架和默认模型接口形状成立。

## Verification

实现完成后必须运行并记录结果到 [tasks/todo.md](../../tasks/todo.md)：

```bash
cd /f/Github/ai-sheet
npm install
```

```bash
cd /f/Github/ai-sheet/src-agent
npm install
npm run build
```

```bash
cd /f/Github/ai-sheet
npm run typecheck
npm run build
```

```bash
cd /f/Github/ai-sheet/src-tauri
cargo check
```

```bash
cd /f/Github/ai-sheet
npm run tauri dev
```

手工验收：

1. 应用窗口能打开。
2. 三栏布局显示正常，视觉符合 [DESIGN.md](../../DESIGN.md) 的克制风格。
3. 中栏显示 Excel 空状态。
4. 前端能显示当前默认模型 DeepSeek-V3。
5. 右栏 Agent 状态显示 online。
6. 输入“你好”后能看到模拟流式回复。
7. 等待至少 10 秒，heartbeat 不报错。
8. 手动结束 sidecar 后，UI 显示 offline/error，而不是白屏。
9. 点击“重连”能触发 `restart_sidecar`。
10. 控制台无明显未处理异常。

若任一验证失败，立即停止实现并重新规划，不继续堆功能。

## Follow-up After This Slice

第一轮通过后，第二轮建议按顺序推进：

1. SQLite + 用户模型配置 CRUD + provider inference 迁移。
2. Excel 文件选择与 calamine 预览最小切片。
3. 将 mock sidecar 内部替换为真实 pi-agent `AgentSession`，保持外部 JSONL 协议稳定。
4. 增加工具调用事件与 `ToolCallCard`。
5. 批处理 mock runner，再逐步接真实 provider、pause/resume/checkpoint/retry。
