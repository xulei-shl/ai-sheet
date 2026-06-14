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

## 11. Sidecar 打包与部署

### 11.1 问题背景

pi-coding-agent 依赖大量 node_modules（约 18MB），直接捆绑到 Tauri 产物中会导致包体积膨胀。而且 sidecar 是独立的 Node.js 子进程，如果 node_modules 未正确打包或路径错误，进程启动后会因 `MODULE_NOT_FOUND` 崩溃。

### 11.2 esbuild 单文件打包方案（推荐）

使用 esbuild 将 sidecar 打包为单个 bundle 文件，无需 node_modules：

```js
// src-agent/build.mjs
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.bundle.mjs',
  external: ['node:*'],           // ← 保留 node 原生模块
  banner: {
    js: `import{createRequire as __cr}from'node:module';import{fileURLToPath as __ftp}from'node:url';var require=__cr(__ftp(import.meta.url));`,
  },
});
```

**关键要点**：

| 配置项 | 说明 |
|--------|------|
| `external: ['node:*']` | 不打包 `fs`, `path` 等原生模块，避免重复 |
| `banner` 中的 `createRequire` | esbuild ESM 格式不自动生成 `require`，部分 CJS 依赖需要 |
| `format: 'esm'` | 与 Tauri sidecar 的 Node.js ESM 加载方式一致 |
| `platform: 'node'` | 正确处理 `process`, `__dirname` 等 Node.js 内置变量 |

### 11.3 Rust 端入口解析

sidecar_manager.rs 优先加载 bundle，回退到 main.js：

```rust
fn resolve_agent_entry(app: &AppHandle) -> AppResult<PathBuf> {
    // 1. 开发模式：项目 src-agent/dist/
    let dist_dir = root.join("src-agent").join("dist");
    let entry = if dist_dir.join("main.bundle.mjs").exists() {
        dist_dir.join("main.bundle.mjs")       // ← 优先 bundle
    } else if dist_dir.join("main.bundle.js").exists() {
        dist_dir.join("main.bundle.js")         // ← 回退 JS bundle
    } else {
        dist_dir.join("main.js")                // ← 最终回退原始 TS 编译产物
    };
    if entry.exists() {
        return Ok(normalize_path(entry));
    }

    // 2. 生产模式：Tauri resource_dir
    // 注意：Windows 上 resource_dir() 返回 \\?\ 前缀路径，Node.js 无法解析
    if let Ok(resource_dir) = app.path().resource_dir() {
        // ... 同上查找逻辑
    }
}
```

### 11.4 Windows 路径标准化

Windows 的 `resource_dir()` 返回 `\\?\` 前缀的 UNC 路径（如 `\\?\C:\Users\...\`），Node.js 无法解析。必须手动去除：

```rust
fn normalize_path(path: PathBuf) -> PathBuf {
    let path_str = path.to_string_lossy();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}
```

### 11.5 tauri.conf.json 资源捆绑

```json
"bundle": {
  "resources": {
    "../.pi/": ".pi/",                     // Agent 规则 + 技能
    "../src-agent/dist/": "src-agent/dist/"  // 打包后的 sidecar
  }
}
```

`../.pi/` 相对于 `src-tauri/`，即项目根目录的 `.pi/` 整个目录树被捆绑。

### 11.6 构建顺序

`beforeBuildCommand` 必须先构建 agent 再构建前端：

```json
"beforeBuildCommand": "npm run agent:build && npm run build"
```

确保 Tauri 打包时 `src-agent/dist/` 目录已存在且是最新的。

---

## 12. 动态工作目录管理

### 12.1 问题背景

pi-agent 的 `cwd` 决定了内置工具（bash/read/write/edit）的相对路径解析基准，也控制了 `DefaultResourceLoader` 对 `.pi/skills/` 的目录扫描。原始实现固定为 `process.cwd()`（项目代码路径），导致工具操作基于代码目录而非用户数据目录。

### 12.2 两层 cwd 策略

| 层 | 机制 | 作用 |
|---|---|---|
| 实际 cwd | `createAgentSession({ cwd: initialCwd })` | 决定内置工具的路径解析基准 |
| 逻辑 cwd | `session.steer()` 通知 + `AgentContext.cwd` 字段 | 告知 agent 当前工作目录，引导其使用正确路径 |

### 12.3 默认 cwd 设置

默认 cwd 为 Tauri `app_data_dir()`（DB 数据库文件所在目录），通过 `--db-dir` 参数传给 sidecar：

```ts
// main.ts
function parseArgs(): { bridgePort: number; dbDir: string } {
  const dbDirIndex = process.argv.indexOf('--db-dir');
  const dbDir = dbDirIndex !== -1 ? process.argv[dbDirIndex + 1] : process.cwd();
  return { bridgePort, dbDir };
}
```

三端路径统一：Rust skill 命令、Agent `DefaultResourceLoader`、前端 `SkillsPage` 均以此为基准。

### 12.4 Excel 加载时自动切换

前端 `addFile` 检测到首个 Excel 文件时，提取父目录，通过 `set_agent_cwd` 命令更新 sidecar 的 cwd：

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

### 12.5 steer 通知格式

cwd 变更后通过 steer 通知 agent：

```ts
await session.steer(
  `[系统通知] 工作目录已变更为: ${command.cwd}。` +
  `后续使用 bash/read/write/edit 工具时，请使用此目录作为基准路径。` +
  `如需执行命令，请先 cd 到该目录。`
);
```

### 12.6 常见陷阱

```ts
// ❌ 错误：固定使用 process.cwd() 作为 agent 的 cwd
// agent 的工作目录会指向项目代码目录，而非用户数据目录
const { session } = await createAgentSession({ cwd: process.cwd() });

// ❌ 错误：只设实际 cwd 不通过 steer 通知
// agent 不知道 cwd 已变更，后续对话仍使用旧路径
currentCwd = newCwd;  // 只更新了变量，agent 不知道

// ✅ 正确：同时更新实际 cwd 并 steer 通知
currentCwd = newCwd;
await session.steer(`[系统通知] 工作目录已变更为: ${newCwd}...`);
```

---

## 13. System Prompt 三层注入

### 13.1 架构概述

三个源文件通过不同机制加载，合并为最终 system prompt：

| 文件 | 加载机制 | 在 System Prompt 中的位置 | 用途 |
|------|----------|---------------------------|------|
| `SYSTEM.md` | `systemPromptOverride` 显式读取 | `customPrompt`（最顶层） | Agent 身份定义 |
| `AGENTS.md` | `agentsFilesOverride` + 自动向上遍历 | `<project_context>` | 核心原则、交互规则 |
| `skills/*/SKILL.md` | `DefaultResourceLoader` 自动发现 | `<available_skills>` | 技能详情 |

### 13.2 代码实现

```ts
// agent.ts
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

const { session } = await createAgentSession({
  // ...
  resourceLoader: loader,  // ← 关键：传入 loader
});
```

### 13.3 回调对比

| 回调 | 输入 | 输出 | 覆盖目标 |
|------|------|------|----------|
| `systemPromptOverride(basePrompt)` | 自动发现的 SYSTEM.md 内容 | 返回字符串替换 `customPrompt` | Pi 默认身份层 |
| `agentsFilesOverride(current)` | `{ agentsFiles: [...] }` | 追加或替换 | `<project_context>` 列表 |

### 13.4 技能自动发现

`DefaultResourceLoader` 自动扫描 `{cwd}/.pi/skills/*/SKILL.md`，无需硬编码。运行时行为：启动时仅注入 name + description 元数据，agent 自主判断是否需要 `read` 加载完整内容后执行。

### 13.5 与动态 cwd 解耦

`.pi/` 下的文件路径由 `initialCwd` 决定（首次运行复制到 `app_data_dir/.pi/`），不依赖 `__dirname` 相对路径。即使后续 cwd 切换到 Excel 文件所在目录，agent 仍能从初始 cwd 的 `.pi/` 加载规则和技能。

### 13.6 Compaction 自动压缩

`SettingsManager.inMemory()` 默认 `compaction.enabled: true`，长对话中自动对早期消息做摘要压缩。可通过 `.pi/settings.json` 配置：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 32768,
    "keepRecentTokens": 40000
  }
}
```

触发条件：`contextTokens > contextWindow - reserveTokens`。

---

## 14. 会话持久化（JSONL SessionManager）

### 14.1 两种模式

| 模式 | 方法 | 存储 |
|------|------|------|
| 内存模式 | `SessionManager.inMemory()` | 无持久化，进程退出丢失 |
| 文件模式 | `SessionManager.create(cwd, sessionDir?)` | JSONL 树状文件，可分支/回退 |

### 14.2 条件选择

```ts
// agent.ts
const { session } = await createAgentSession({
  sessionManager: sessionDir
    ? SessionManager.create(initialCwd, sessionDir)
    : SessionManager.inMemory(),
  // ...
});
```

`--session-dir` 由 Rust 端在启动 sidecar 时注入，路径为 `app_data_dir/sessions/`。

### 14.3 启动行为

每次启动 sidecar，`SessionManager.create()` 生成新的 UUID 会话文件。**重启不自动加载历史会话**，始终从新文件开始。历史 JSONL 保留磁盘供后续历史浏览功能使用。

### 14.4 重置行为

前端"清空对话"按钮触发 `session.sessionManager.newSession()`，在当前文件内创建新分支，不会丢失已写入的会话条目。

### 14.5 JSONL 格式特性

- **追加写**：每条消息/操作作为一行 JSON，支持 `id`/`parentId` 链式追踪
- **树状分支**：`branch()` 回溯到历史节点、`forkFrom()` 复制会话文件
- **上下文压缩**：Compaction 摘要作为特殊 entry 记录，不影响树结构

---

## 15. .env 加载策略

### 15.1 问题背景

sidecar 是 Node.js 子进程，不会自动加载 `.env`。需要在入口最顶部显式加载。

### 15.2 多路径查找

生产模式和开发模式的 `.env` 位置不同：

```ts
// main.ts 顶部
const dbDirIdx = process.argv.indexOf('--db-dir');
const dbDir = dbDirIdx !== -1 ? process.argv[dbDirIdx + 1] : undefined;
const envCandidates = [
  dbDir && join(dbDir, '.env'),           // 生产模式：app_data_dir/.env
  join(__dirname, '..', '..', '.env'),    // 开发模式：项目根/.env
].filter(Boolean) as string[];
const envPath = envCandidates.find((p) => existsSync(p));
if (envPath) {
  loadDotenv({ path: envPath, quiet: true });
}
```

### 15.3 必须在所有 import 之前

```ts
// ✅ 正确：.env 加载在所有 import 之前
import { config as loadDotenv } from 'dotenv';
// ... 加载 .env
import { createInterface } from 'node:readline';  // ← .env 已加载

// ❌ 错误：import 在 .env 加载之前
import { createInterface } from 'node:readline';
import { config as loadDotenv } from 'dotenv';
// ... 加载 .env（此时 undici 等模块可能已读取了错误的环境变量）
```

### 15.4 .env 内容

```
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
# NO_PROXY=localhost,127.0.0.1
```

---

## 16. Windows 路径兼容性

### 16.1 UNC 路径前缀

Windows 的 `tauri::PathResolver::resource_dir()` 在某些场景下返回 `\\?\` 前缀的 UNC 路径。Node.js 无法解析此类路径，必须手动去除：

```rust
fn normalize_path(path: PathBuf) -> PathBuf {
    let path_str = path.to_string_lossy();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}
```

### 16.2 何时会遇到

- Tauri 打包后的生产模式（`resource_dir()`）
- 长路径（超过 260 字符的 MAX_PATH 限制）

### 16.3 常见症状

Sidecar 启动后立即退出，日志无报错或报 `MODULE_NOT_FOUND`——实际是 Node.js 解析了错误的入口路径。

---

## 17. stdin/stdout JSONL 协议最佳实践

### 17.1 协议结构

Rust 和 Node.js sidecar 通过 stdin/stdout 以 JSONL（每行一个 JSON）通信：

```
Rust → Sidecar (stdin):  {"id":"msg-123","type":"user_message","content":"..."}
Sidecar → Rust (stdout): {"type":"agent_delta","id":"msg-123","delta":"Hello"}
Sidecar → Rust (stdout): {"type":"agent_done","id":"msg-123"}
```

### 17.2 心跳机制

Sidecar 每 5 秒发送心跳，Rust 端 15 秒无心跳即判定 sidecar 死亡：

```ts
// sidecar 端
heartbeatInterval = setInterval(() => {
  emit({ type: 'heartbeat', timestamp: new Date().toISOString() });
}, 5_000).unref();  // ← .unref() 避免阻止进程退出
```

```rust
// Rust 端
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);

fn spawn_heartbeat_monitor(self: &Arc<Self>, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let status = manager.status().await;
            if !status.ready {
                app.emit("sidecar-dead", json!({...})).ok();
                break;
            }
        }
    });
}
```

### 17.3 超时保护

```rust
// Rust 端 stdin 写入超时
const SEND_TIMEOUT: Duration = Duration::from_secs(3);

tokio::time::timeout(SEND_TIMEOUT, stdin.write_all(&line))
    .await
    .map_err(|_| AppError::SidecarTimeout)??;
```

### 17.4 空行过滤

管道关闭时会产生空行，必须过滤，避免 `JSON.parse('')` 报错：

```ts
// Node.js 端
reader.on('line', (line) => {
  if (!line.trim()) return;  // ← 跳过空行
  // ...
});
```

```rust
// Rust 端
while let Ok(Some(line)) = lines.next_line().await {
    if line.trim().is_empty() {
        continue;  // ← 跳过空行
    }
    // ...
}
```

### 17.5 stderr 捕获

Sidecar 的 stderr 通过管道捕获并转发到前端，生产环境可查看错误日志：

```rust
fn spawn_stderr_reader(self: &Arc<Self>, app: AppHandle, stderr: ChildStderr) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                eprintln!("[sidecar stderr] {line}");
                app.emit("sidecar-stderr", json!({ "line": line })).ok();
            }
        }
    });
}
```

### 17.6 Windows 隐藏控制台窗口

```rust
#[cfg(windows)]
{
    use std::os::windows::process::CommandExt;
    cmd.as_std_mut().creation_flags(0x08000000); // CREATE_NO_WINDOW
}
```

---

## 18. HTTP Bridge 数据服务

### 18.1 架构

Sidecar 通过 HTTP Bridge 访问 Rust 端的数据服务（Excel 读写、配置查询等），而非直接操作文件系统：

```
Sidecar (Node.js)
   │ HTTP POST /api/excel/info
   ▼
BridgeServer (Rust, 127.0.0.1:动态端口)
   │ 调用 ExcelService / ConfigService
   ▼
返回 JSON 结果
```

### 18.2 动态端口分配

```rust
// bridge_server.rs
let listener = TcpListener::bind("127.0.0.1:0")?;  // ← 动态端口
let port = listener.local_addr()?.port();
// 端口号注入 SidecarManager，通过 --bridge-port 传给 sidecar
```

### 18.3 BridgeClient 实现

```ts
// bridge.ts
export class BridgeClient {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),  // ← 30 秒超时
    });
    // ...
  }

  async getDefaultModel(): Promise<ModelConfig> {
    return this.post('/api/config/default');
  }
}
```

### 18.4 本地请求绕过代理

fetch override 中本地请求使用原始 fetch，避免受 SSE 超时影响：

```ts
if (urlStr.startsWith('http://127.0.0.1') || urlStr.startsWith('http://localhost')) {
  return originalFetch(input, init);  // ← 绕过 undici dispatcher
}
```

### 18.5 启动顺序

`lib.rs` 中先启动 Bridge，再启动 Sidecar（带 `--bridge-port`）：

```
1. BridgeServer::start() → 拿到 port
2. SidecarManager::set_bridge_port(port)
3. SidecarManager::start() → node main.bundle.mjs --bridge-port <port>
```

---

## 19. 上下文注入 via steer()

### 19.1 steer 与 prompt 的区别

| 机制 | 何时被消费 | 用途 |
|------|-----------|------|
| `session.steer(text)` | 当前工具调用结束后、下一轮 LLM 调用前 | 动态上下文注入（不打断当前流程） |
| `session.prompt(content)` | 立即 | 用户请求 |

### 19.2 steer 消息格式

Excel 上下文更新格式（多文件自适应）：

```ts
const filesBlock = files.map((f, i) => {
  const header = files.length > 1 ? `--- 文件 ${i + 1} ---\n` : '';
  const sheets = f.sheets.map((sh) => {
    const cols = sh.columns.map((c) => `${c.letter}(${c.name})`).join(', ');
    return `${sh.sheetName}[${cols}]`;
  }).join('; ');
  return `${header}文件: ${f.name}\n路径: ${f.path}\n工作表: ${sheets}`;
}).join('\n\n');

const contextText = `[系统上下文更新]\n${filesBlock}\n当前工作目录：${currentCwd}${sampleText}`;
await session.steer(contextText);
```

### 19.3 steer 在 LLM 侧的表现

steer 消息出现在对话 history 中，作为 `{role: "user"}` 消息，排在当前消息之前：

```
messages: [
  { role: "system", content: "..." },
  { role: "user", content: "[系统上下文更新] 当前文件：sales.xlsx\n..." },  // ← steer
  { role: "assistant", content: "..." },
  { role: "user", content: "帮我计算利润率" },  // ← 用户实际请求
]
```

---

## 20. 中断与取消机制

### 20.1 协议设计

前端通过 `stop` 命令中断 agent 生成：

```ts
// main.ts
case 'stop':
  if (session) {
    abortRequested = true;
    session.abort().catch((error) => {
      log(`session.abort() failed: ${error}`);
    });
  }
  break;
```

### 20.2 abort 后的状态清理

```ts
// handleUserMessage 中
try {
  unsubscribe = session.subscribe((event) => { ... });
  await session.prompt(command.content);
} catch (error) {
  if (abortRequested) {
    abortRequested = false;
    emit({ type: 'agent_done', id: command.id });  // ← 清除前端流式状态
  } else {
    emit({ type: 'agent_error', id: command.id, message });
  }
} finally {
  if (unsubscribe) unsubscribe();
}

// prompt 完成后检查
if (abortRequested) {
  abortRequested = false;
  emit({ type: 'agent_done', id: command.id });
} else if (lastError === '__aborted__') {
  emit({ type: 'agent_done', id: command.id });
}
```

### 20.3 常见陷阱

```ts
// ❌ 错误：abort 后不发 agent_done
// 前端 agentStore 仍在 streaming 状态，UI 卡住

// ❌ 错误：abortRequested 检查顺序错误
// 先检查 lastError 再检查 abortRequested，可能导致 abort 被忽略

// ✅ 正确：abort 优先级最高，先检查
if (abortRequested) { ... }
else if (lastError) { ... }
```

---

## 21. 批量处理模式

### 21.1 架构

BatchRunner 使用 `stream()` 函数直接调用 LLM，不经过 Agent Session：

```ts
const eventStream = stream(model, {
  systemPrompt: '你是一个数据处理助手。根据用户指令处理数据，只返回处理结果。',
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
}, { temperature, apiKey });

for await (const event of eventStream) {
  if (event.type === 'done') { /* 提取完整文本 */ }
  if (event.type === 'error') { throw new Error(event?.error?.errorMessage); }
}
```

### 21.2 apiKey 透传

`options.apiKey` 直接传入优先级最高，绕过 AuthStorage 查找链：

```ts
const options: any = { temperature };
if (apiKey) options.apiKey = apiKey;  // ← 直接传入
```

### 21.3 指数退避重试

```ts
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    return await this._callLLM(model, prompt, temperature, apiKey);
  } catch (error) {
    if (attempt < maxRetries - 1) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);  // 1s → 2s → 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

### 21.4 断点续传

```ts
// 从 checkpoint 恢复
const resumeFrom = await this._getCheckpoint(tracker);

for (let i = resumeFrom; i < data.rows.length; i++) {
  // 处理每一行...
  this._saveCheckpoint(i + 1);  // 每行完成后保存
}
```

---

## 22. 系统代理检测

### 22.1 问题背景

Tauri 应用中有两个独立的 HTTP 客户端，它们获取代理配置的方式不同：

| 客户端 | 使用场景 | 代理检测方式 |
|--------|----------|-------------|
| Rust `reqwest` | 配置管理页面"测试连接" | **自动检测** Windows 系统代理（注册表） |
| sidecar `EnvHttpProxyAgent` | 实际 LLM 调用 | **只读** `HTTP_PROXY`/`HTTPS_PROXY` 环境变量 |

当用户仅在 Windows 系统设置中配置了代理（而非设置环境变量）时：
- "测试连接"走 `reqwest` → 自动走代理 → ✅ 成功
- 实际 LLM 调用走 `EnvHttpProxyAgent` → 找不到环境变量 → 直连 → 被企业防火墙拦截 → ❌ 403 Forbidden

**修复方案**：Rust 启动 sidecar 前，从 Windows 注册表检测系统代理并注入为环境变量，使 `EnvHttpProxyAgent` 能拿到与 `reqwest` 一致的代理配置。

### 22.2 三层优先级

```
1. 父进程环境变量 (HTTP_PROXY / HTTPS_PROXY)  ← 已有则直接信任
2. Windows 注册表系统代理 (HKCU\...\Internet Settings)  ← 未有时从注册表读取
3. 无代理（直连）  ← ProxyEnable=0 或注册表无代理配置
```

### 22.3 Windows 注册表读取

```rust
fn detect_windows_proxy() -> (Option<String>, Option<String>, Option<String>) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")?;

    let proxy_enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if proxy_enable == 0 { return (None, None, None); }

    let proxy_server: String = key.get_value("ProxyServer").unwrap_or_default();
    let no_proxy: String = key.get_value("ProxyOverride").unwrap_or_default();
    // ProxyServer 支持两种格式：
    // 1. "proxy:8080"              — 所有协议共用
    // 2. "http=proxy:80;https=443" — 按协议分别设置
}
```

### 22.4 注入到 Sidecar 子进程

```rust
let (http_proxy, https_proxy, no_proxy) = detect_proxy_settings();
if let Some(ref url) = http_proxy { cmd.env("HTTP_PROXY", url); }
if let Some(ref url) = https_proxy { cmd.env("HTTPS_PROXY", url); }
if let Some(ref url) = no_proxy { cmd.env("NO_PROXY", url); }
```

---

## 23. 日志与错误处理

### 23.1 stderr 日志模式

Sidecar 使用 stderr 输出日志（stdout 专用于 JSONL 协议），避免协议污染：

```ts
const log = (msg: string) => process.stderr.write(`[sidecar] ${msg}\n`);
```

### 23.2 全局异常捕获

```ts
process.on('uncaughtException', (error) => {
  emit({ type: 'agent_error', message: `未捕获异常: ${error.message}` });
});

process.on('unhandledRejection', (reason) => {
  emit({
    type: 'agent_error',
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
```

### 23.3 Agent 初始化失败

```ts
try {
  const ctx = await createSheetAgent(bridge, currentCwd, args.sessionDir);
  session = ctx.session;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`agent init failed: ${message}`);
  emit({ type: 'agent_error', message: `Agent 初始化失败: ${message}` });
}
```

初始化失败不阻塞 sidecar 启动——sidecar 仍发送 `sidecar_ready`，但后续 prompt 请求会返回"Agent 未初始化"错误。

### 23.4 空输出检测

```ts
if (!accumulatedText) {
  emit({
    type: 'agent_error',
    id: command.id,
    message: '模型未返回任何输出，请检查模型ID和API配置是否正确',
  });
}
```

---

## 24. 参考文件

| 文件 | 说明 |
|------|------|
| `src-agent/src/provider-map.ts` | Provider/API 映射模块，providerType → { provider, api } |
| `src-agent/src/proxy-state.ts` | 代理状态管理，与 fetch override 配合 |
| `src-agent/src/protocol.ts` | Sidecar 协议定义，含 set_model/set_cwd 命令和事件 |
| `src-agent/src/main.ts` | Sidecar 入口，双 Dispatcher + .env 加载 + 命令路由 |
| `src-agent/src/agent.ts` | Agent Session 创建，ResourceLoader 三层注入 |
| `src-agent/src/bridge.ts` | HTTP Bridge 客户端，30s AbortSignal 超时 |
| `src-agent/src/batch/runner.ts` | 批量处理，apiKey 透传 + 指数退避 + 断点续传 |
| `src-agent/build.mjs` | esbuild 单文件打包配置 |
| `src-tauri/src/services/sidecar_manager.rs` | Sidecar 进程管理，心跳 + 超时 + 路径标准化 |
| `src-tauri/src/services/bridge_server.rs` | HTTP Bridge 动态端口服务 |
| `src-tauri/src/commands/config.rs` | 配置命令，set_active_model + fallback |
| `src-tauri/tauri.conf.json` | 资源捆绑配置 |
| `src/stores/agentStore.ts` | 前端 Agent 状态，model_switch_result + 失败回滚 |
| `.pi/SYSTEM.md` | Agent 身份定义 |
| `.pi/AGENTS.md` | 顶层基础原则 |
| `.pi/skills/*/SKILL.md` | 技能详情（自动发现） |
| `pi-ai/dist/stream.js` | `stream()` 函数，支持 `options.apiKey` |
| `pi-coding-agent/dist/core/sdk.js` | `createAgentSession()` 实现 |
| `pi-coding-agent/dist/core/agent-session.d.ts` | AgentSession API（`setModel`, `steer`, `abort`） |
| `pi-coding-agent/dist/core/resource-loader.d.ts` | DefaultResourceLoader API |
| `pi-coding-agent/dist/core/session-manager.d.ts` | SessionManager API（`inMemory`, `create`, `newSession`） |

---

**文档版本**：v4.0
**更新日期**：2026-06-14
**适用版本**：pi-ai 0.x, pi-coding-agent 0.78+
