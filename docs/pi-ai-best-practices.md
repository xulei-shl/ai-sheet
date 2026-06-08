# pi-ai / pi-coding-agent 最佳实践

> 基于 ai-sheet 项目实践总结，适用于任何需要调用 pi-ai 或 pi-coding-agent 的场景。

---

## 1. 核心概念区分

### 1.1 Provider vs API Type

| 概念 | 说明 | 示例 |
|------|------|------|
| **Provider** | 模型提供商身份标识，用于 API Key 查找 | `'openai'`, `'anthropic'`, `'mistral'`, `'deepseek'` |
| **API Type** | API 协议/格式类型，决定请求格式和 SDK 选择 | `'openai-completions'`, `'openai-responses'`, `'anthropic-messages'`, `'mistral-conversations'` |

**关键区别**：
- `provider` 用于查找 API key（`authStorage.getApiKey(model.provider)` → 环境变量映射）
- `api` 决定请求格式、使用的 SDK 和 endpoint 路径

```js
// 内置模型示例
{ id: 'gpt-4o',               provider: 'openai',    api: 'openai-responses' }
{ id: 'claude-3-5-sonnet',    provider: 'anthropic', api: 'anthropic-messages' }
{ id: 'mistral-small-latest', provider: 'mistral',   api: 'mistral-conversations' }
{ id: 'deepseek-chat',        provider: 'deepseek',  api: 'openai-completions' }  // ← 注意：api 不是 'deepseek'
```

### 1.2 Provider 与 API Type 可以不同

这是最常见的混淆点。许多 provider 使用 OpenAI 兼容协议：

```
deepseek    → api: 'openai-completions'  (DeepSeek 用 OpenAI 格式)
groq        → api: 'openai-completions'  (Groq 用 OpenAI 格式)
cerebras    → api: 'openai-completions'  (Cerebras 用 OpenAI 格式)
mistral     → api: 'mistral-conversations' (Mistral 有自己的 SDK 和协议)
google      → api: 'google-generative-ai'
```

**如果混淆二者**，会出现以下错误：
- `provider: 'deepseek'` + `api: 'deepseek'` → ❌ "No API provider registered for api: deepseek"
- `provider: 'openai-completions'` + `api: 'openai-completions'` → ❌ API key 查找时用 `OPENAI-COMPLETIONS_API_KEY`，不存在

### 1.3 Provider-Map 模式（推荐）

当项目中用户配置的 `providerType` 字段同时承载了 provider 身份和 API 协议信息时，需要一个运行时映射模块来正确拆分：

```ts
// provider-map.ts
const PROVIDER_TYPE_MAP: Record<string, { provider: string; api: string }> = {
  'openai-completions':     { provider: 'openai',          api: 'openai-completions' },
  'openai-responses':       { provider: 'openai',          api: 'openai-responses' },
  'anthropic-messages':     { provider: 'anthropic',       api: 'anthropic-messages' },
  'deepseek':               { provider: 'deepseek',        api: 'openai-completions' },  // ← 关键映射
  'mistral-conversations':  { provider: 'mistral',         api: 'mistral-conversations' },
  'google-generative-ai':   { provider: 'google',          api: 'google-generative-ai' },
};

export function resolveProviderApi(providerType: string): { provider: string; api: string } {
  const mapped = PROVIDER_TYPE_MAP[providerType];
  if (mapped) return mapped;

  // heuristic: providerType 以已知 API 后缀结尾，截取前缀为 provider
  for (const suffix of KNOWN_API_SUFFIXES) {
    if (providerType.endsWith('-' + suffix)) {
      const provider = providerType.slice(0, providerType.length - suffix.length - 1);
      if (provider) return { provider, api: suffix };
    }
  }
  // fallback
  return { provider: providerType, api: providerType };
}

export function buildModel(info: { providerType: string; modelId: string; name?: string; baseUrl?: string }): Model<any> {
  const { provider, api } = resolveProviderApi(info.providerType);
  return {
    id: info.modelId, name: info.name ?? info.modelId,
    api, provider, baseUrl: info.baseUrl || '',
    reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000, maxTokens: 16_384,
  } as Model<any>;
}
```

---

## 2. AuthStorage 与 ModelRegistry

### 2.1 AuthStorage 的职责

`AuthStorage` 管理 API key 的存储和查找：

```ts
const authStorage = AuthStorage.inMemory();
authStorage.setRuntimeApiKey(providerName, apiKey);

// 查找优先级
// 1. runtimeOverrides（setRuntimeApiKey 设置的）
// 2. auth.json 文件存储
// 3. 环境变量（按 provider 名称映射，如 'openai' → OPENAI_API_KEY）
// 4. fallbackResolver
```

### 2.2 ModelRegistry 的职责

`ModelRegistry` 管理模型列表和 auth 解析：

```ts
const modelRegistry = ModelRegistry.inMemory(authStorage);

// SDK 内部调用链
// session.prompt() → streamFn → modelRegistry.getApiKeyAndHeaders(model)
//                                              ↓
//                                authStorage.getApiKey(model.provider)
```

### 2.3 关键：registerProvider 必须同时指定 api 字段

```ts
// ❌ 错误：缺少 api 字段，SDK 无法选择正确的 API 实现
modelRegistry.registerProvider('deepseek', {
  apiKey: 'sk-xxx',
  baseUrl: 'https://api.deepseek.com/v1',
  models: [model],
} as any);

// ✅ 正确：provider 级别和 model 级别都要有正确的 api
modelRegistry.registerProvider(model.provider, {
  api: model.api,          // ← 必须指定，如 'openai-completions'
  apiKey: userApiKey,
  baseUrl: userBaseUrl,
  models: [model],         // model 对象中也包含正确的 api 字段
} as any);
```

---

## 3. 正确构造模型对象

### 3.1 通过 Provider-Map 构造（推荐）

```ts
const model = buildModel({
  providerType: userConfig.providerType,  // 如 'deepseek'
  modelId: userConfig.modelId,            // 如 'deepseek-chat'
  baseUrl: userConfig.baseUrl,
});
// model.provider = 'deepseek'
// model.api = 'openai-completions'

modelRegistry.registerProvider(model.provider, {
  api: model.api,
  apiKey: userConfig.apiKey,
  baseUrl: userConfig.baseUrl,
  models: [model],
} as any);
```

### 3.2 不要搜索内置模型

```ts
// ❌ 错误：尝试匹配内置模型
const builtIn = getModel('openai', userConfig.modelId);
// 问题：
// 1. modelId 可能不在内置列表中（如 'deepseek-chat'）
// 2. 即使找到，内置模型的 api/provider 可能与用户配置不同
// 3. 例如 mistral-small-latest 的 api 是 'mistral-conversations'，
//    而用户可能配置了 'openai-completions'

// ✅ 正确：直接用用户配置构建
const model = buildModel(userConfig);
```

---

## 4. Stream 事件处理

### 4.1 事件类型体系

`stream()` 函数返回 `AsyncIterable<AssistantMessageEvent>`，主要事件类型：

| 事件类型 | 说明 | 关键字段 |
|----------|------|----------|
| `text_delta` | 文本增量 | `delta: string` |
| `error` | 错误 | `error: AssistantMessage`（含 `errorMessage`） |
| `done` | 流结束 | `message: AssistantMessage`（含完整 content） |
| `thinking_delta` | 思考增量 | `delta: string` |
| `toolcall_start` | 工具调用开始 | — |
| `toolcall_delta` | 工具调用增量 | — |
| `toolcall_end` | 工具调用结束 | — |

### 4.2 正确的事件处理循环

```ts
const eventStream = stream(model, context, options);

for await (const ev of eventStream as AsyncIterable<any>) {
  if (ev.type === 'text_delta') {
    // ✅ 正确：text_delta 事件有 delta 字段
    const delta: string = ev.delta ?? '';
    if (delta) { /* 处理增量文本 */ }
  } else if (ev.type === 'error') {
    // ✅ 正确：error 事件的 error 字段是 AssistantMessage，有 errorMessage
    const errorMsg = ev.error?.errorMessage ?? 'LLM 返回错误';
    break;
  } else if (ev.type === 'done') {
    // done 事件的 message.content 包含完整输出
    for (const content of ev.message.content) {
      if (content.type === 'text') { /* 完整文本 */ }
    }
  }
  // 其他事件类型按需处理
}
```

### 4.3 常见错误

```ts
// ❌ 错误：用 ev.text 或 ev.content 取增量
// pi-ai 中不存在 ev.text 字段，只有 ev.delta

// ❌ 错误：不区分事件类型，所有事件都尝试取文本
// 非 text_delta 事件没有 delta 字段

// ❌ 错误：忘记处理 error 事件
// error 事件的 error.errorMessage 包含具体错误信息
```

---

## 5. 网络代理配置

### 5.1 问题背景

在中国网络环境下，部分 LLM API 需要代理才能访问（OpenAI、Anthropic），而另一些可以直接连接（DeepSeek、本地模型）。pi-ai 内部使用 `globalThis.fetch` 发起请求，可以通过覆盖 fetch 来控制代理行为。

### 5.2 双 Dispatcher 模式（推荐）

使用 undici 创建两个 dispatcher，在 fetch override 中根据模型配置动态切换：

```ts
import { getUseProxy, setUseProxy } from './proxy-state.js';

async function initialize() {
  const { createRequire } = await import('node:module');
  const undici = createRequire(import.meta.url)('undici');

  const timeoutConfig = {
    allowH2: false,
    bodyTimeout: 600_000,     // 10 分钟
    headersTimeout: 300_000,  // 5 分钟
  };

  // 代理 dispatcher：读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY
  const proxyDispatcher = new undici.EnvHttpProxyAgent(timeoutConfig);

  // 直连 dispatcher：忽略代理环境变量
  const directDispatcher = new undici.Agent(timeoutConfig);

  undici.setGlobalDispatcher(proxyDispatcher);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: any, init: any) => {
    let urlStr: string;
    if (typeof input === 'string') urlStr = input;
    else if (input instanceof URL) urlStr = input.toString();
    else if (input?.url) urlStr = input.url;  // Request 对象
    else urlStr = String(input);

    // 本地请求用原始 fetch
    if (urlStr.startsWith('http://127.0.0.1') || urlStr.startsWith('http://localhost')) {
      return originalFetch(input, init);
    }

    // 根据当前模型的代理设置选择 dispatcher
    const dispatcher = getUseProxy() ? proxyDispatcher : directDispatcher;
    return undici.fetch(input, { ...init, dispatcher });
  };
}
```

### 5.3 代理状态同步

每个 LLM 调用入口在发起请求前同步代理状态：

```ts
// agent.ts
setUseProxy(defaultModel.useProxy ?? true);

// direct-llm.ts
setUseProxy(modelInfo.useProxy ?? true);

// batch/runner.ts
setUseProxy(params.useProxy ?? true);
```

### 5.4 .env 文件加载

sidecar 是 Node.js 子进程，不会自动加载 `.env`。需要在入口最顶部显式加载：

```ts
// main.ts 顶部（必须在所有其他 import 之前）
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, '..', '..', '.env') });
```

`.env` 文件内容：
```
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
# NO_PROXY=localhost,127.0.0.1
```

### 5.5 处理 Request 对象

部分 SDK（如 Mistral）传递 `Request` 对象给 `fetch()`，而非字符串 URL：

```ts
// ❌ 错误：String(requestObj) → "[object Request]"
// ✅ 正确：requestObj.url → "https://api.mistral.ai/v1/..."
if (input?.url) urlStr = input.url;
```

### 5.6 数据库字段与 serde 兼容

新增 `use_proxy` 字段时需注意旧数据兼容：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModel {
    // ...其他字段
    #[serde(default = "default_use_proxy")]
    pub use_proxy: bool,
}

fn default_use_proxy() -> bool { true }
```

数据库迁移默认值设为 `1`（启用），与原来全局走代理的行为一致：

```sql
ALTER TABLE models ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 1;
```

---

## 6. SettingsManager 超时配置

### 6.1 默认超时可能不够

部分模型冷启动很慢（尤其是非主流 provider），默认超时可能导致请求被过早中断。

```ts
const settingsManager = SettingsManager.inMemory({
  httpIdleTimeoutMs: 60000,   // 空闲超时
  retry: { maxRetries: 0 },   // 禁用自动重试，避免重复请求
});
```

### 6.2 注意事项

- `httpIdleTimeoutMs` 控制 SSE 流式传输期间的空闲超时，过短会导致长回复中断
- `maxRetries` 设为 0 避免代理环境下重试加剧延迟
- undici 的 `bodyTimeout` / `headersTimeout` 是独立于 pi-ai 设置的另一层超时保护，需要同时配置

---

## 7. Direct LLM 调用（不经过 Agent）

使用 `stream()` 函数直接调用 LLM：

```ts
import { stream } from '@earendil-works/pi-ai';

const model = buildModel({
  providerType: userConfig.providerType,
  modelId: userConfig.modelId,
  baseUrl: userConfig.baseUrl,
});

const eventStream = stream(model, {
  systemPrompt: '...',
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
}, {
  temperature: 0.3,
  signal: abortController.signal,
  apiKey: userApiKey,  // ← 直接传入，优先级最高
});
```

**关键**：`options.apiKey` 直接传入优先级最高，绕过 AuthStorage 查找链。

---

## 8. Agent Session 调用

```ts
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';

const model = buildModel(userConfig);
setUseProxy(userConfig.useProxy ?? true);

const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);

modelRegistry.registerProvider(model.provider, {
  api: model.api,           // ← 必须指定
  apiKey: userConfig.apiKey,
  baseUrl: userConfig.baseUrl,
  models: [model],
} as any);

const settingsManager = SettingsManager.inMemory({
  httpIdleTimeoutMs: 60000,
  retry: { maxRetries: 0 },
});

const { session } = await createAgentSession({
  model,
  tools: ['read', 'bash', 'edit', 'write'],
  customTools,
  authStorage,
  modelRegistry,
  settingsManager,
  sessionManager: SessionManager.inMemory(),
  cwd: process.cwd(),
});

await session.prompt('你的问题');
```

---

## 9. 常见陷阱汇总

### 9.1 `process.env` 不生效

```ts
// ❌ 错误：pi-coding-agent 不读 process.env 设置 API key
process.env.OPENAI_API_KEY = apiKey;

// ✅ 正确：通过 AuthStorage 或 options.apiKey 传入
authStorage.setRuntimeApiKey('openai', apiKey);
// 或 stream(model, context, { apiKey });
```

### 9.2 Provider 与 API Type 混淆

```ts
// ❌ 错误：DeepSeek 用 'deepseek' 作为 api
{ provider: 'deepseek', api: 'deepseek' }
// → "No API provider registered for api: deepseek"

// ✅ 正确：DeepSeek 使用 OpenAI 兼容协议
{ provider: 'deepseek', api: 'openai-completions' }
```

### 9.3 测试连接 ≠ 实际调用

配置管理页面的"测试"只是简单的 HTTP GET：

```ts
fetch(`${model.baseUrl}/models`, {
  headers: { 'Authorization': `Bearer ${model.apiKey}` }
});
```

实际调用需要正确的 `api` 格式和完整的 model 对象。测试通过不代表实际调用能成功。

### 9.4 内置模型列表有限

```ts
// 内置的
getModel('openai', 'gpt-4o');  // ✅ 找到

// 非内置的
getModel('deepseek', 'deepseek-chat');  // ❌ 找不到
getModel('openai', 'deepseek-chat');    // ❌ 找不到
```

自定义模型必须手动构造 model 对象。

### 9.5 undici fetch 与 Request 对象

```ts
// Mistral SDK 传递 Request 对象给 fetch
// ❌ String(request) → "[object Request]"（不是有效 URL）
// ✅ request.url → 实际 URL 字符串
```

### 9.6 旧数据兼容

新增字段时，`serde` 反序列化旧 JSON 会因缺少字段而失败。务必使用 `#[serde(default)]`：

```rust
#[serde(default = "default_use_proxy")]
pub use_proxy: bool,
```

---

## 10. 运行时模型切换（不重启 Sidecar）

### 10.1 问题背景

初始实现中，用户切换模型时 Rust 后端调用 `sidecar_manager.restart()`，杀掉整个 Node.js sidecar 进程再重启。这导致 `AgentSession` 的对话历史完全丢失。

### 10.2 解决方案：set_model 协议命令

pi-coding-agent SDK 的 `AgentSession` 已提供 `setModel(model)` 方法，支持运行时切换模型。我们通过新增 stdin 协议命令 `set_model`，让 sidecar 原地切换模型，保留对话历史。

**数据流**：

```
前端 applyModel(name)
   │
   ▼
Rust: set_active_model → send_set_model(payload) via stdin
   │
   ▼
Node.js: handleSetModel
   ├── setUseProxy(model.useProxy)
   ├── modelRegistry.registerProvider(...)   // 注册/更新 provider（upsert 语义）
   └── session.setModel(model)               // 原地切换，保留对话历史
   │
   ▼
emit model_switch_result { success, modelName?, error? }
   │
   ▼
Rust → agent-event → 前端 handleEvent
   ├── success: true  → appliedModelName = modelName, isApplyingModel = false
   └── success: false → 回滚 selectedAgentModelName, 显示错误
```

### 10.3 协议扩展

```typescript
// 新增命令
export interface SetModelInfo {
  name: string;
  providerType: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  useProxy?: boolean;
}

// SidecarCommand 新增变体
| { id: string; type: 'set_model'; model: SetModelInfo }

// SidecarEvent 新增变体
| { type: 'model_switch_result'; id: string; success: boolean; error?: string; modelName?: string }
```

### 10.4 关键设计决策

| 决策 | 理由 |
|------|------|
| 先 `registerProvider` 再 `setModel` | `setModel` 内部会校验 `hasConfiguredAuth`，必须先注册 provider |
| `setUseProxy` 在 `registerProvider` 之前调用 | 确保 auth 校验时 fetch 路由到正确的代理/直连 |
| `clear_active_model` 仍走 restart | AgentSession 无模型时无法响应 prompt，重启是正确行为 |
| `send_set_model` 失败时 fallback 到 restart | 处理 sidecar 尚未就绪的边界情况 |
| `model_switch_result` 通过 `agent-event` 流转 | 保持架构一致性，避免引入第二套事件通道 |
| 切换失败时回滚 `selectedAgentModelName` | 下拉框显示必须与实际 active model 一致 |

### 10.5 agent.ts 导出变更

`createSheetAgent` 返回类型从 `AgentSession` 改为 `SheetAgentContext`，暴露 `modelRegistry` 和 `authStorage`：

```typescript
export interface SheetAgentContext {
  session: AgentSession;
  modelRegistry: ModelRegistry;
  authStorage: AuthStorage;
}
```

这是因为 `set_model` 处理中需要访问 `modelRegistry`（注册新 provider）和 `authStorage`（SDK 内部鉴权依赖）。

### 10.6 常见陷阱

```ts
// ❌ 错误：直接调用 setModel 不先注册 provider
await session.setModel(newModel);
// → "No API key for provider/model" 抛出

// ❌ 错误：切换失败后不回滚 UI 状态
// selectedAgentModelName 指向新模型，但实际 active 的仍是旧模型
// 用户看到的下拉框选中项与实际运行模型不一致

// ✅ 正确：先注册 provider，再 setModel
modelRegistry.registerProvider(model.provider, { api, apiKey, baseUrl, models: [model] } as any);
await session.setModel(model);

// ✅ 正确：失败时回滚 UI 选择状态
useUiStore.getState().setSelectedAgentModelName(appliedModelName);
```

---

## 11. 参考文件

| 文件 | 说明 |
|------|------|
| `src-agent/src/provider-map.ts` | Provider/API 映射模块，providerType → { provider, api } |
| `src-agent/src/proxy-state.ts` | 代理状态管理，与 fetch override 配合 |
| `src-agent/src/protocol.ts` | Sidecar 协议定义，含 set_model 命令和 model_switch_result 事件 |
| `src-agent/src/main.ts` | Sidecar 入口，双 Dispatcher + .env 加载 + set_model 处理 |
| `src-agent/src/agent.ts` | Agent Session 创建，导出 SheetAgentContext（session + modelRegistry + authStorage） |
| `src-agent/src/direct-llm.ts` | 直接 LLM 调用，stream() 事件处理范例 |
| `src-agent/src/batch/runner.ts` | 批量处理，apiKey 透传范例 |
| `src-tauri/src/services/sidecar_manager.rs` | Sidecar 进程管理，含 send_set_model 方法 |
| `src-tauri/src/commands/config.rs` | 配置命令，set_active_model 使用 send_set_model + fallback |
| `src/stores/agentStore.ts` | 前端 Agent 状态，处理 model_switch_result 事件 + 失败回滚 |
| `pi-ai/dist/stream.js` | `stream()` 函数，支持 `options.apiKey` |
| `pi-ai/dist/types.d.ts` | `Model<Api>` 类型定义 |
| `pi-coding-agent/dist/core/sdk.js` | `createAgentSession()` 实现 |
| `pi-coding-agent/dist/core/agent-session.d.ts` | AgentSession API，含 `setModel()` 方法 |
| `pi-coding-agent/dist/core/auth-storage.d.ts` | AuthStorage API |
| `pi-coding-agent/dist/core/model-registry.d.ts` | ModelRegistry API（`registerProvider` 有 upsert 语义） |
| `pi-coding-agent/dist/core/settings-manager.d.ts` | SettingsManager API |

---

**文档版本**：v3.0
**更新日期**：2026-06-08
**适用版本**：pi-ai 0.x, pi-coding-agent 0.78+
