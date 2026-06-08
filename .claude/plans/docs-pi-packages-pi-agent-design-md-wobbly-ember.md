# 每模型代理开关（Per-Model Proxy Toggle）

## Context

用户在中国网络环境下使用本应用时，部分 LLM API（如 OpenAI、Anthropic）需要通过 HTTP 代理才能访问，而另一些（如 DeepSeek）可以直接连接。当前项目的 undici `EnvHttpProxyAgent` 是全局生效的——所有 LLM 请求都走代理或都不走，无法针对不同模型独立控制。

目标：在每个模型配置中添加「启用代理」开关。开启时该模型的 API 请求走系统代理（HTTP_PROXY/HTTPS_PROXY），关闭时直连。不同模型可独立设置。

---

## 修改计划

### 1. 数据库迁移 — 新增 `use_proxy` 列

**文件**: `src-tauri/src/db/migrations.rs`

在 `MIGRATIONS` 数组末尾添加 v6 迁移：

```sql
ALTER TABLE models ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 1;
```

默认值 1（启用代理），与当前全局行为一致，不破坏现有用户体验。

---

### 2. Rust 结构体 — 添加 `use_proxy` 字段

**文件**: `src-tauri/src/models/config.rs`

- `ModelConfig` 添加 `pub use_proxy: bool`
- `ActiveModel` 添加 `pub use_proxy: bool`

两者都使用 `#[serde(rename_all = "camelCase")]`，序列化后为 `useProxy`。

---

### 3. Rust 数据库查询 — 支持 `use_proxy`

**文件**: `src-tauri/src/db/models_repo.rs`

- `get_all_models`: SELECT 增加 `use_proxy` 列，映射到结构体
- `insert_model`: INSERT 增加 `use_proxy` 列
- `update_model`: UPDATE SET 增加 `use_proxy`
- 测试中 `sample_model()` 添加 `use_proxy: true`

---

### 4. Rust Bridge — 下发 `useProxy`

**文件**: `src-tauri/src/services/bridge_server.rs`

`/api/config/default` 端点的 JSON 响应添加 `"useProxy": m.use_proxy`。

---

### 5. Rust 命令 — 映射新字段

**文件**: `src-tauri/src/commands/config.rs`

`get_active_model` 中 `ModelConfig` 构造添加 `use_proxy: m.use_proxy`。
（`set_active_model` 接收 `ActiveModel`，serde 自动处理新字段，无需手动改。）

---

### 6. 前端类型 — `ModelConfig` 添加 `useProxy`

**文件**: `src/types/config.ts`

```typescript
useProxy: boolean;  // 新增
```

---

### 7. 前端表单 — 代理开关 UI

**文件**: `src/pages/ConfigPage.tsx`

- `ModelFormData` 接口添加 `useProxy: boolean`
- `emptyForm` 默认值 `useProxy: true`
- `loadIntoForm` 映射 `useProxy: model.useProxy`
- `handleSave` 构造 `ModelConfig` 时包含 `useProxy: form.useProxy`
- `FormPanel` 中 API Key 字段下方添加 toggle 开关
- `DetailView` 中在 API Key 字段下方展示代理状态（启用代理: 是/否）
- `handleTest` / `handleDetailTest` 传入 `useProxy`

---

### 8. Sidecar — 代理状态管理模块

**新建文件**: `src-agent/src/proxy-state.ts`

```typescript
let currentUseProxy = true;
export function getUseProxy(): boolean { return currentUseProxy; }
export function setUseProxy(value: boolean): void { currentUseProxy = value; }
```

---

### 9. Sidecar — 双 Dispatcher 架构

**文件**: `src-agent/src/main.ts`

重构 `initialize()` 中的 fetch override，创建两个 dispatcher：

- `proxyDispatcher`: `new undici.EnvHttpProxyAgent({ ... })` — 读取 HTTP_PROXY/HTTPS_PROXY
- `directDispatcher`: `new undici.Agent({ ... })` — 直连，不读代理环境变量

fetch override 中根据 `getUseProxy()` 返回值选择 dispatcher。直连 `Agent` 配置相同的 `bodyTimeout` / `headersTimeout` 保持超时保护一致。

---

### 10. Sidecar — 各 LLM 调用入口同步代理状态

**文件**: `src-agent/src/agent.ts`
在 `createSheetAgent()` 中获取 `defaultModel` 后调用 `setUseProxy(defaultModel.useProxy ?? true)`。

**文件**: `src-agent/src/direct-llm.ts`
在 `runDirectLlmStream()` 中获取 `modelInfo` 后调用 `setUseProxy(modelInfo.useProxy ?? true)`。

**文件**: `src-agent/src/batch/runner.ts`
在 `run()` 方法中获取 params 后调用 `setUseProxy(params.useProxy ?? true)`。

**文件**: `src-agent/src/protocol.ts`
`BatchParams` 接口添加 `useProxy?: boolean`。

**文件**: `src-agent/src/bridge.ts`
`getDefaultModel()` 返回类型添加 `useProxy?: boolean`。

**文件**: `src-agent/src/main.ts`
`handleBatchStart()` 中将 `useProxy` 从 bridge 获取并传递给 batch params。

---

## 实施顺序

1. DB 迁移 (migrations.rs)
2. Rust 结构体 (config.rs)
3. Rust 数据库查询 (models_repo.rs)
4. Rust Bridge + 命令 (bridge_server.rs, config.rs)
5. 前端类型 (types/config.ts)
6. 前端表单 UI (ConfigPage.tsx)
7. Sidecar 代理模块 (proxy-state.ts)
8. Sidecar fetch 重构 (main.ts)
9. Sidecar 各入口同步 (agent.ts, direct-llm.ts, batch/runner.ts, protocol.ts, bridge.ts, main.ts batch handler)

## 验证

1. `cd src-tauri && cargo test` — DB 迁移和 models_repo 测试通过
2. `cd src-agent && npx tsc --noEmit` — 类型检查通过
3. 启动应用，新增模型 → 确认「启用代理」开关默认开启
4. 关闭代理开关，使用该模型发送消息 → 确认请求直连（不走 HTTP_PROXY）
5. 开启代理开关，使用该模型发送消息 → 确认请求走代理
6. 不同模型使用不同代理设置 → 确认独立生效
