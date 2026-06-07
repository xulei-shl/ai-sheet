# 开发者交接手册（HANDOFF）

> 写给下一个接手的工程师。本文不重复 `DESIGN.md` 里的设计原则，专注于：
> - 当前**实装到了什么程度**（✅/⚠/❌ 标记）
> - 怎么把项目**在本地跑起来**
> - 已知 **Bug、缺口、设计偏离**
> - 下一阶段**建议任务清单**（按优先级）
>
> 配套文档：
> - `DESIGN.md` — 系统设计与架构
> - `PRODUCT.md` — 产品定位 / 非功能指标
> - `docs/PROTOCOL.md` — IPC + Sidecar JSONL 协议
> - `AGENT.md` — 编码行为准则

---

## 1. 30 秒快速理解

AI-Sheet 是一个**桌面端 Excel + AI Agent** 应用，定位是"自然语言 → 公式 / 提示词 / Python 代码 / 批量处理"。

- **三进程**：Tauri（Rust 核心）+ Node.js Sidecar（pi-agent）+ React WebView。
- **三栏 UI**：左导航 / 中数据 / 右 Agent 对话。
- **双模式**：核心功能既能由中栏直接执行，也能由右栏 Agent 辅助。
- **数据栈**：Rust `calamine`/`rust_xlsxwriter` 处理 Excel，SQLite 存配置/提示词/公式历史，plugin-store 加密 API Key。

设计原则（务必先看）：`PRODUCT.md` §Brand Personality、`AGENT.md`。

---

## 2. 本地开发

### 2.1 依赖

| 工具 | 版本 |
|---|---|
| Node.js | ≥ 20.x |
| pnpm 或 npm | 任选 |
| Rust | stable + `rustup` |
| Tauri CLI | 2.x |
| Windows | WebView2（Win11 自带；Win10 需安装） |

### 2.2 一次性配置

```bash
# 根目录
npm install
cd src-agent && npm install && cd ..

# Rust 工具链（如未装）
rustup target add x86_64-pc-windows-msvc
```

### 2.3 启动开发

需要**两个终端**：

```bash
# 终端 1：构建并监听 src-agent
cd src-agent
npm run dev          # tsx 跑 main.ts，文件改动会重启（或配 --watch）

# 终端 2：启动 Tauri 开发模式
npm run tauri dev    # 同时启动 Vite + Rust
```

> **重要**：`SidecarManager::resolve_agent_entry()` 默认找 `src-agent/dist/main.js`。
> 开发时需要先把 `src-agent` 编译为该路径：
>
> ```bash
> cd src-agent
> npm run build      # 产出 dist/main.js
> ```
>
> 或临时把 `sidecar_manager.rs` 的路径改成 `src/main.ts` + `tsx` 启动。

### 2.4 验证

| 命令 | 含义 |
|---|---|
| `cargo test` | Rust 单元测试（28 项已通过） |
| `cargo check` | Rust 类型检查 |
| `npm run typecheck` | 前端 TypeScript 检查 |

### 2.5 数据文件位置

- SQLite：`app_data_dir/ai-sheet.db`（如 Windows `%APPDATA%\ai-sheet\ai-sheet.db`）。
- Secure Store：`app_data_dir/ai-sheet-secure.json`（API Key 加密）。
- 批量断点：`cwd/.batch-checkpoints/checkpoint.json`（**注意：开发时在 Tauri cwd 即项目根**）。

---

## 3. 当前实现状态总览

### 3.1 已完成 ✅

| 模块 | 文件 | 状态 |
|---|---|---|
| Tauri 2 + Vite + React + Tailwind 脚手架 | `package.json` / `vite.config` / `Cargo.toml` | ✅ |
| 4 个 tauri-plugin 集成 | `Cargo.toml` / `tauri.conf.json` / `capabilities/default.json` | ✅ |
| SQLite + 5 张表迁移 | `src-tauri/src/db/*` | ✅ |
| Excel 读取（calamine） | `excel_service.rs::get_info/columns/sample/column_data/processing_status` | ✅ |
| Excel 写入（rust_xlsxwriter） | `excel_service.rs::write_results/apply_formula` | ✅ |
| 公式历史缓存 | `formula_cache.rs` + `formula.ts` + `FormulaPage` | ✅ |
| HTTP Bridge Server（动态端口） | `bridge_server.rs` | ✅ |
| Sidecar 进程管理 + 心跳 + 超时 | `sidecar_manager.rs` | ✅ |
| 14 个 Excel/Prompt/Config Tauri Commands | `commands/*` | ✅ |
| pi-agent 集成（自定义 8 工具 + bash） | `src-agent/src/tools/*` | ✅ |
| `AgentSession` 启动 + 系统提示词 | `src-agent/src/agent.ts` + `prompts/system.ts` | ✅ |
| BatchRunner（断点/暂停/重试） | `src-agent/src/batch/runner.ts` | ✅ |
| 三栏 AppLayout + Resize + 响应式 | `src/layouts/AppLayout.tsx` | ✅ |
| 5 个 Store（Zustand） | `src/stores/*` | ✅ |
| DataPage（拖放/Sheet/列/预览） | `src/pages/DataPage.tsx` | ✅ |
| FormulaPage（输入/预览/应用/历史） | `src/pages/FormulaPage.tsx` | ✅ |
| LLMProcessingPage（双触发/进度/日志/控制） | `src/pages/LLMProcessingPage.tsx` | ✅ |
| PythonProcessingPage | `src/pages/PythonProcessingPage.tsx` | ✅ |
| ConfigPage（CRUD + 测试连接 + 内置模型） | `src/pages/ConfigPage.tsx` | ✅ |
| PromptsPage | `src/pages/PromptsPage.tsx` | ✅ |
| AgentChatPanel + 事件订阅 | `src/components/agent/*` | ✅ |
| 错误边界 + 状态组件 | `src/components/ui/*` | ✅ |
| 键盘快捷键 | `src/hooks/useKeyboardShortcuts.ts` | ✅ |
| API Key 加密存储 | `src/services/secureStore.ts` + plugin-store | ✅ |
| Rust 单元测试 28 项 | `*_service.rs` 末尾 | ✅ |
| 上下文联动（Excel → Agent） | `excelStore.notifyContextChange` → `steer_agent` | ✅ |

### 3.2 已知缺口 / 设计偏离 ⚠

> 按严重度排序。这些不影响基本功能跑通，但生产前必须解决。

#### 3.2.1 严重：自动降级未实装

**设计**：用户配置失败 → 自动降级到 DeepSeek-V3 → 再降级到 GLM-4-Flash。
**现状**：`ConfigService` 暴露 `get_fallback_chain()` 给 Agent 侧，但**没有
调用方真正循环尝试**。当前依赖 pi-ai Provider 自身的 Provider 级别重试。

**修复方向**：
- 方案 A：在 `BatchRunner._processRowWithRetry` 之外，新增 `ModelFallbackService`
  包装 `stream()` 调用，按链依次尝试。
- 方案 B：把降级逻辑放在 pi-ai Provider 之上（`callWithFallback`）。
- 前端要监听 `bridge-notification` 事件，显示 Toast 警告。

参考：`docs/upgrade-plan-additions.md` §9。

#### 3.2.2 中等：SessionManager 未持久化

**设计**：对话历史存为 `~/.ai-sheet/sessions/*.jsonl`，支持分支。
**现状**：`SessionManager.inMemory()`，**关闭应用对话即丢失**。

**修复方向**：切换到 `SessionManager.create(appDataDir + '/sessions')`，
但需要确认 pi-agent 0.78 API 兼容性。

#### 3.2.3 中等：Agent 恢复 UI 未实装

**现状**：`sidecar-dead` / `sidecar-restarted` 事件已发，监听函数
`onSidecarDead` / `onSidecarRestarted` 在 `tauri.ts` 中已写好，但**没有
React 组件订阅它们**。

**修复方向**：在 `AgentChatPanel` 顶部增加"AI Agent 正在重启 / 已重连"
状态条；提供手动 `restart()` 按钮。

#### 3.2.4 中等：批量进度与 Agent 上下文未联动

**设计**：批量处理中或完成后，Agent 应能感知进度变化。
**现状**：`processingStore` 仅本地更新，**没有调用 `steer_agent`**。

**修复方向**：在 `subscribeToEvents` 关键事件中触发 `steer_agent`，
或在 `BatchRunner.onProgress` 中通过 `emit` 暴露 `batch_progress` 到
Sidecar，再让 Node.js 调 `session.steer()`。

#### 3.2.5 中等：模型 fallback 链里"用户默认"语义模糊

`models.is_default` 是布尔型，**只支持一个默认**。设计文档提到多模型
排序，但 schema 只能有一个 `is_default=1`。

**修复方向**：在 `commands/config.rs::add_user_model` 中加约束：写入新
默认时把其它清零；或在 `settings` 表加 `default_model_id` 字段。

#### 3.2.6 中等：公式应用 `{}` 占位符语义反直觉

```rust
// excel_service.rs::apply_formula
let formula_str = req.formula.replace("{}", &(excel_row + 1).to_string());
```

`formula.replace("{}", ...)` **只替换第一个 `{}`**。用户写 `=A{}+B{}`
会得到 `=A2+B{}`（第一行），不是预期。

**修复方向**：用 `replace_all` 或正则 `/\\{\\}/g` 替换全部。

#### 3.2.7 较轻：旧版本 `get_sample_data` 的 row_count 重复计算

迁移记录里提到修复了 `data row 计数 bug`，但代码中 `get_info` 仍按
"header + rows.count()" 算行数——若 header 行为空时 `first_row` 是
`None`，`rows` 会被错算。**测试中目前没覆盖此边界**。

#### 3.2.8 较轻：HTTP Bridge 没有请求体大小限制

`bridge_server.rs` 直接 `read_exact(content_length)` 读取请求体，没有
上限。LLM 长提示词（>1MB）可能撑爆。建议加 `MAX_BODY_SIZE = 5MB` 保护。

#### 3.2.9 较轻：跨文件公式引用未设计

设计稿（`upgrade-summary.md` §3.3）提到公式引用两个不同 Excel/Sheet 时
格式未定义。`apply_formula` 简单替换行号，但 `=VLOOKUP(A2, [wb2.xlsx]...`
这种跨文件引用会原样写入，不被 Excel 解析。

**修复方向**：在 `FormulaPage` UI 提示限制；或预处理公式字符串。

#### 3.2.10 较轻：PythonProcessingPage 是占位实现

`src/pages/PythonProcessingPage.tsx` 是脚本编辑器 + 本地执行模式，**没有
走 Sidecar**。设计意图是"用户在右栏让 Agent 生成 Python → 通过 bash 工具
执行"。当前右栏没有专门触发 Python 的入口，**用户实际可走通的工作流是：
在右栏对话中让 Agent 用 bash 工具跑 Python**。

#### 3.2.11 较轻：Ant Design 5 安装但未在页面中实际使用

`package.json` 里有 `antd`，但所有 UI 组件都是自写 + Tailwind，**没有
import antd 组件**。可考虑移除依赖或选择性引入复杂组件（Table、Tree）。

### 3.3 未设计的功能（Phase 0-4 之外的）

- 暗色 / 亮色 / 系统三主题切换（CSS 变量已支持，需加切换 UI）
- 应用图标（`src-tauri/icons/icon.ico` 已有占位）
- 自动更新触发 UI（plugin-updater 已配，但没 UI）
- 安装包构建（NSIS / DMG）
- 数据迁移（从旧版 Python JSON 导入）
- E2E 测试
- 国际化（i18next）准备工作

---

## 4. 推荐的下一阶段任务

按价值/工作量比排序。每项标注**预估工时**（单人）和**优先级**。

### P0 — 必须做

| # | 任务 | 工作量 | 说明 |
|---|---|---|---|
| 1 | 实装自动降级 `ModelFallbackService` | 1d | §3.2.1 |
| 2 | 修复公式 `{}` 替换为 replace_all | 0.25d | §3.2.6，加单元测试 |
| 3 | 实现 Agent 恢复 UI（订阅 sidecar-dead） | 0.5d | §3.2.3 |
| 4 | HTTP Bridge 请求体大小限制 | 0.25d | §3.2.8 |

### P1 — 强烈建议

| # | 任务 | 工作量 | 说明 |
|---|---|---|---|
| 5 | 切换 SessionManager 到文件持久化 | 1d | §3.2.2 |
| 6 | 批量进度 → Agent 上下文注入 | 0.5d | §3.2.4 |
| 7 | 默认模型唯一性约束迁移 | 0.5d | §3.2.5 |
| 8 | 在 `get_info` / `get_sample_data` 加空 header 测试 | 0.25d | §3.2.7 |
| 9 | Python 页面真正接到 Sidecar（可选） | 1d | §3.2.10 |
| 10 | 清理 antd 依赖或选择性引入 | 0.25d | §3.2.11 |

### P2 — 体验优化

| # | 任务 | 工作量 | 说明 |
|---|---|---|---|
| 11 | 主题切换 UI | 0.5d | 复用现有 CSS 变量 |
| 12 | 自动更新提示 UI | 0.5d | plugin-updater 已配 |
| 13 | 跨文件公式引用方案 + 文档 | 0.5d | §3.2.9 |
| 14 | E2E 测试（Vitest + Playwright 至少配置） | 2d | |
| 15 | 打包发布流水线（NSIS / DMG） | 1d | |

### P3 — 未来扩展

| # | 任务 | 工作量 |
|---|---|---|
| 16 | i18n（i18next） | 2d |
| 17 | 数据迁移工具（旧 Python JSON 导入） | 1d |
| 18 | 暗色 / 亮色 / 系统三主题 + 用户偏好持久化 | 1d |

---

## 5. 改动约定

接手前请阅读 `AGENT.md` 全文。

几条对本项目特别重要的：
- **不要顺手重构无关代码**。每个 PR 只做一件事。
- **Rust 改动必须跑 `cargo test`**。28 项测试覆盖了主要 Excel 路径。
- **新加 Tauri Command 记得三处**：
  1. `commands/*.rs` 加函数
  2. `lib.rs::invoke_handler!` 注册
  3. `src/services/tauri.ts` 加 TS 包装
- **新加 SidecarCommand 三处**：
  1. `src-agent/src/protocol.ts` 的 `SidecarCommand` 联合
  2. `main.ts::handleCommand` 加 case
  3. `SidecarManager::send_*` Rust 方法 + `commands/sidecar.rs` 注册
- **新加 pi-agent 工具三处**：
  1. `src-agent/src/tools/<name>-tools.ts` 用 `defineTool` 写
  2. `tools/mod.ts` 的 `createCustomTools` 中聚合
  3. （如需 HTTP Bridge）`bridge_server.rs` 加路由
- **CSS 颜色全部用 CSS 变量**。不要硬编码 `oklch()` 在组件里。

---

## 6. 常见问题

### 6.1 Sidecar 启动失败

症状：右栏一直不 ready，devtools 里看到 `bridge-notification` 或
`sidecar-dead`。

排查顺序：
1. `src-agent/dist/main.js` 是否存在？`npm run build` 一下。
2. `node` 在 PATH 里吗？`node --version`。
3. 看 Tauri 日志：`tauri.conf.json` 中 `withGlobalTauri` 设 true，
   浏览器 devtools 选 "Tauri" 标签。
4. `sidecar_manager.rs` 的 `resolve_agent_entry()` 路径对吗？调试时打
   `path` 日志。

### 6.2 公式应用结果不对

1. 用 Excel 打开原文件确认列名精确匹配。
2. `{}` 占位符：见 §3.2.6，注意只替换第一个。
3. 如果公式里有 `IFERROR` 等函数依赖行间引用，单独抽一行手测。

### 6.3 批量卡住

1. `processingStore.isRunning` 是 true 但 `batchProgress.current` 不动？
   → 查 `bridge_server.rs` 是否被阻塞（HTTP 30s 超时）。
2. 重试次数已满（3 次）后 `batch-error` 事件会不会触发？
   → 会，但前端要 `subscribeToEvents()` 才能收到。

### 6.4 切换 Tab 上下文没注入

1. `excelStore.notifyContextChange()` 是不是只在上传/选列时调用？
   切换 Tab 没自动触发。
2. Sidecar 那边 `session.steer()` 是下轮生效的，当前对话不会改。

### 6.5 SQLite 锁

`Database` 用 `Mutex<Connection>`，并发调用会串行化。**不要在 `conn.lock()`
持有期间调任何 async 操作**——会导致死锁。`bridge_server.rs` 已注意此点。

### 6.6 API Key 加密后丢失

plugin-store 加密机制与平台相关（Windows DPAPI 等）。**重装系统或换用户
后旧 key 不可解密**。当前实装没有"重新输入"提示，下个版本建议加 UI。

---

## 7. 联系方式与历史

- 项目所有变更历史：参见 `docs/upgrade-summary.md`（已完成清单）。
- 旧版 Python 源码与 v1→v2 决策依据：`docs/precious-snuggling-avalanche.md`。
- 任何设计偏离本文档的：先更新本文档，再改代码。

---

**文档版本**：v1.0  
**更新日期**：2026-06-07
