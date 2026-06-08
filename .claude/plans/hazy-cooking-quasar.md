# Fix: Agent 发消息和快捷调用找不到已选模型的 API Key

## Context

用户在 Agent 面板下拉框中选择了大模型配置（在配置管理页测试连接也正常），但：
1. **Agent 对话发消息** → 报错 `No API key found for the selected model`
2. **快捷调用**（公式生成/提示词生成） → 报错 `当前未配置默认模型`

### 根因分析

**Bug 1 — Agent Chat "No API key found"：**
- `agent.ts:createSheetAgent()` 调用 `getModel(providerType, modelId)` 获取模型对象
- `getModel()` 只认识 pi-ai 内置模型 ID（如 `gpt-4o`、`claude-3-5-sonnet-latest`）
- 用户的自定义模型（如 `deepseek-chat`）不在内置列表中 → `getModel()` 返回 `undefined` → `model = undefined`
- `applyApiKeyEnv()` 设置了 `process.env.OPENAI_API_KEY`，但 `pi-coding-agent` 的 `ModelRegistry.getApiKeyAndHeaders()` 不读 `process.env`，它用自己的 `AuthStorage`（文件系统 `~/.pi/agent/auth.json`），里面没有用户的 API key
- Agent session 用 `model: undefined` + 空 AuthStorage → 报 "No API key found"

**Bug 2 — Direct LLM "当前未配置默认模型"：**
- `direct-llm.ts` 同样调用 `getModel()` → 返回 `undefined`
- `if (!model)` 判断直接触发错误消息

**额外问题 — active_model 不持久化：**
- `AppState.active_model` 是进程内存中的 `RwLock<Option<ActiveModel>>`，app 重启后为 `None`
- `/api/config/default` 在 `active_model` 为 `None` 时返回硬编码默认（无 apiKey）
- 虽然前端 `AgentInput` mount 时会调用 `applyModel()` 恢复，但有时序竞争

## 修复方案

### 1. `src-agent/src/direct-llm.ts` — 构造自定义 Model 对象 + 传 apiKey

**核心改动：**
- 当 `getModel()` 返回 `undefined` 时，手动构造 `Model<Api>` 对象（含 `id`、`api`、`provider`、`baseUrl` 等必要字段）
- 将 `apiKey` 通过 `stream()` 的 `options.apiKey` 参数直接传入（pi-ai 的 `stream()` 优先使用 `options.apiKey`，代码见 `stream.js:9`）
- 删除无效的 `applyApiKeyEnv()` 和 `PROVIDER_API_KEY_ENV` 常量

```ts
// 构造 Model 对象
let model: any;
let resolvedApiKey: string | undefined;

const builtIn = getModel(modelInfo.providerType as any, modelInfo.modelId as any);
if (builtIn) {
  model = modelInfo.baseUrl ? { ...builtIn, baseUrl: modelInfo.baseUrl } : builtIn;
} else {
  // 自定义模型：手动构造
  model = {
    id: modelInfo.modelId,
    name: modelInfo.name ?? modelInfo.modelId,
    api: modelInfo.providerType,
    provider: modelInfo.providerType,
    baseUrl: modelInfo.baseUrl || '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}
resolvedApiKey = modelInfo.apiKey;

// 调用 stream 时传入 apiKey
stream(model, context, { temperature: 0.3, signal: controller.signal, apiKey: resolvedApiKey });
```

### 2. `src-agent/src/agent.ts` — 使用 AuthStorage.inMemory + ModelRegistry.inMemory

**核心改动：**
- 创建 `AuthStorage.inMemory()` 实例，调用 `setRuntimeApiKey()` 注册 API key
- 创建 `ModelRegistry.inMemory(authStorage)` 实例，对自定义模型用 `registerProvider()` 注册
- 将 `authStorage` 和 `modelRegistry` 传入 `createAgentSession()` options

```ts
const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);

if (defaultModel) {
  const builtIn = getModel(defaultModel.providerType as any, defaultModel.modelId as any);
  if (builtIn) {
    model = defaultModel.baseUrl ? { ...builtIn, baseUrl: defaultModel.baseUrl } : builtIn;
  } else {
    // 自定义模型
    model = { /* 手动构造 */ };
    if (defaultModel.apiKey) {
      modelRegistry.registerProvider(defaultModel.providerType, {
        apiKey: defaultModel.apiKey,
        baseUrl: defaultModel.baseUrl,
        models: [{ /* ... */ }],
      });
    }
  }
  // 对内置模型也注册 API key
  if (defaultModel.apiKey) {
    authStorage.setRuntimeApiKey(defaultModel.providerType, defaultModel.apiKey);
  }
}

const { session } = await createAgentSession({
  model,
  authStorage,
  modelRegistry,
  // ... 其他不变
});
```

- 删除 `applyApiKeyEnv()` 和 `PROVIDER_API_KEY_ENV`

### 3. `src-tauri/src/db/settings_repo.rs` — 新增设置仓库（持久化 active_model）

**新建文件**，使用已有的 `settings` 表（migration v5 已创建但从未使用）：

```rust
pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>>
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()>
pub fn delete_setting(conn: &Connection, key: &str) -> AppResult<()>
```

在 `src-tauri/src/db/mod.rs` 中添加 `pub mod settings_repo;`

### 4. `src-tauri/src/lib.rs` — 启动时恢复 active_model

在 `setup` 闭包中，数据库初始化之后、bridge/sidecar 启动之前，从 `settings` 表读取 `active_model` JSON 并写入 `AppState.active_model`：

```rust
// 在 db.run_migrations() 之后
let conn = db.get_conn().await; // 注意需要同步方式或在 spawn 前完成
if let Ok(Some(json)) = settings_repo::get_setting(&conn, "active_model") {
    if let Ok(model) = serde_json::from_str::<ActiveModel>(&json) {
        *state.active_model.write().await = Some(model); // 或 block_on
    }
}
```

### 5. `src-tauri/src/commands/config.rs` — set/clear 时持久化

- `set_active_model`: 在写入 `AppState.active_model` 后，同时将 `ActiveModel` 序列化为 JSON 写入 `settings` 表（key = `"active_model"`）
- `clear_active_model`: 删除 `settings` 表中 key = `"active_model"` 的记录

两个命令都需要新增 `db: State<'_, Arc<Database>>` 参数。

### 6. `src-tauri/src/services/bridge_server.rs` — fallback 路径补充 baseUrl

当 `active_model` 为 `None` 时的 fallback 路径，补充 `baseUrl` 字段：

```rust
} else {
    let model = state.config_service.get_active_model();
    serde_json::json!({
        "providerType": model.provider_type,
        "modelId": model.model_id,
        "baseUrl": model.base_url,  // 新增
    })
}
```

## 实现顺序

1. **`src-agent/src/direct-llm.ts`** — 修复 Bug 2（最简单，自包含）
2. **`src-agent/src/agent.ts`** — 修复 Bug 1（更复杂）
3. **`src-tauri/src/db/settings_repo.rs`** — 新建持久化仓库
4. **`src-tauri/src/db/mod.rs`** — 注册模块
5. **`src-tauri/src/commands/config.rs`** — set/clear 持久化
6. **`src-tauri/src/lib.rs`** — 启动恢复
7. **`src-tauri/src/services/bridge_server.rs`** — fallback 补充字段

## 关键文件

| 文件 | 操作 |
|------|------|
| `src-agent/src/direct-llm.ts` | 修改：手动构造 Model，传 apiKey |
| `src-agent/src/agent.ts` | 修改：AuthStorage.inMemory + ModelRegistry.inMemory |
| `src-tauri/src/db/settings_repo.rs` | 新建 |
| `src-tauri/src/db/mod.rs` | 修改：注册模块 |
| `src-tauri/src/commands/config.rs` | 修改：持久化 active_model |
| `src-tauri/src/lib.rs` | 修改：启动恢复 |
| `src-tauri/src/services/bridge_server.rs` | 修改：fallback 补字段 |

## 验证

1. `npm --prefix src-agent run build` — Sidecar 编译通过
2. `cargo check --manifest-path src-tauri/Cargo.toml` — Rust 编译通过
3. `npm run typecheck` — 前端类型检查通过
4. `npm run tauri dev` 启动后：
   - 选择自定义模型 → Agent 对话发消息 → 正常流式输出
   - 选择自定义模型 → 快捷按钮 → 正常流式输出
   - 关闭重启 app → 模型选择仍然生效，无需重新选择
   - Agent 对话 + Direct LLM 并发不串流
