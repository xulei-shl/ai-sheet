# 运行时模型切换（不重启 Sidecar）

## Context

当前切换模型时，Rust 后端调用 `sidecar_manager.restart()`，杀掉整个 Node.js 进程再重启。这导致 `AgentSession` 的对话历史完全丢失。pi-coding-agent SDK 的 `AgentSession.setModel()` 已支持运行时切换模型，无需重启。

**目标**：切换模型时通过 stdin 协议发送 `set_model` 命令，sidecar 原地切换模型，保留对话历史。

---

## 变更清单

### 1. `src-agent/src/protocol.ts` — 新增协议类型

- 新增 `SetModelInfo` 接口（与前端 `ActiveAgentModel` 同构）
- `SidecarCommand` 新增变体：`{ id: string; type: 'set_model'; model: SetModelInfo }`
- `SidecarEvent` 新增变体：`{ type: 'model_switch_result'; id: string; success: boolean; error?: string; modelName?: string }`

### 2. `src-agent/src/agent.ts` — 导出 modelRegistry 和 authStorage

- 修改 `createSheetAgent` 返回类型为 `{ session, modelRegistry, authStorage }`
- 函数体不变，仅改 return 语句

### 3. `src-agent/src/main.ts` — 处理 set_model 命令

- 模块级变量新增 `modelRegistry`、`authStorage`
- `initialize()` 中解构 `createSheetAgent` 返回值
- 新增 `handleSetModel(command)` 函数：
  1. 调用 `setUseProxy(model.useProxy)`
  2. 调用 `buildModel(model)` 构造 Model 对象
  3. 调用 `modelRegistry.registerProvider()` 注册/更新 provider
  4. 调用 `session.setModel(model)` 切换模型
  5. 成功/失败均 emit `model_switch_result` 事件
- `handleCommand` switch 新增 `case 'set_model'`

### 4. `src-tauri/src/services/sidecar_manager.rs` — 新增 send_set_model 方法

- `pub async fn send_set_model(&self, model: ActiveModel) -> AppResult<()>`
- 构造 `{ id, type: "set_model", model: { name, providerType, modelId, apiKey, baseUrl, useProxy } }` JSON
- 调用 `write_json_line(payload)`
- 处理 `model_switch_result` 事件：在 `handle_sidecar_event` 中检测该类型，直接通过 `agent-event` 转发（不单独派发，保持架构一致性）

### 5. `src-tauri/src/commands/config.rs` — 替换 restart 为 send_set_model

- `set_active_model`：
  - 保留 `AppState.active_model` 更新和 DB 持久化
  - 将 `sidecar_manager.restart(app)` 替换为 `sidecar_manager.send_set_model(model)`
  - 如果 `send_set_model` 返回 `SidecarUnavailable`，fallback 到 `restart(app)`（处理 sidecar 尚未就绪的情况）
- `clear_active_model`：保留 restart 行为不变（AgentSession 无模型时无法工作）

### 6. `src/types/agent.ts` — 新增前端事件类型

- `SidecarEvent` 新增变体：`{ type: 'model_switch_result'; id: string; success: boolean; error?: string; modelName?: string }`

### 7. `src/stores/agentStore.ts` — 处理 model_switch_result 事件

- `handleEvent` 新增 `model_switch_result` 分支：
  - `success: true` → 设置 `appliedModelName`，清除 `isApplyingModel`、`error`
  - `success: false` → 设置 `error`，清除 `isApplyingModel`
- 调整 `applyModel`：发送 `setActiveAgentModel` 后**不立即**设 `appliedModelName`，等 `model_switch_result` 事件回来再设（当前代码在 Tauri invoke 成功后就设了，但此时 sidecar 可能还没完成切换）

---

## 关键设计决策

| 决策 | 理由 |
|------|------|
| `model_switch_result` 通过 `agent-event` 流转 | 保持架构一致性，避免引入第二套事件通道 |
| `clear_active_model` 仍走 restart | AgentSession 无模型时无法响应 prompt，重启是正确行为 |
| `send_set_model` 失败时 fallback 到 restart | 处理 sidecar 未就绪的边界情况 |
| 先 `registerProvider` 再 `setModel` | `setModel` 会校验 `hasConfiguredAuth`，必须先注册 |
| `setUseProxy` 在 `registerProvider` 之前调用 | 确保 auth 校验时 fetch 路由正确 |

---

## 验证方式

1. 启动应用，选择模型 A，发送几条消息确认多轮对话正常
2. 切换到模型 B，确认切换后历史消息仍在，新消息由模型 B 回复
3. 切换回模型 A，确认历史完整，新消息由模型 A 回复
4. 输入错误 API Key 切换模型，确认 UI 显示错误提示
5. 应用启动时模型选择器自动恢复上次模型，确认正常
6. 清除模型，确认 sidecar 重启
