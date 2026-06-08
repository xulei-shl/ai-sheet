# pi-ai / pi-coding-agent 最佳实践

> 基于 ai-sheet 项目实践总结，适用于任何需要调用 pi-ai 或 pi-coding-agent 的场景。

---

## 1. 核心概念区分

### 1.1 Provider vs API Type

| 概念 | 说明 | 示例 |
|------|------|------|
| **Provider** | 模型提供商名称，pi-ai 内部标识 | `'openai'`, `'anthropic'`, `'mistral'`, `'deepseek'` |
| **API Type** | API 协议/格式类型 | `'openai-completions'`, `'openai-responses'`, `'anthropic-messages'`, `'mistral-conversations'` |

**关键区别**：
- `provider` 用于查找 API key 环境变量映射（如 `openai` → `OPENAI_API_KEY`）
- `api` 决定请求格式和使用的 SDK

```js
// 内置模型示例
{ id: 'gpt-4o', provider: 'openai', api: 'openai-responses' }
{ id: 'claude-3-5-sonnet', provider: 'anthropic', api: 'anthropic-messages' }
{ id: 'mistral-small-latest', provider: 'mistral', api: 'mistral-conversations' }
```

### 1.2 用户配置中的 `providerType`

在 ai-sheet 的配置管理页面，用户配置的 `providerType` 实际上是 **API Type**，不是 provider 名称：

```ts
// 用户配置示例
{
  name: 'Mistral API',
  providerType: 'openai-completions',  // ← 这是 API Type
  modelId: 'mistral-small-latest',
  baseUrl: 'https://api.mistral.ai/v1',
  apiKey: 'xxx'
}
```

**最佳实践**：完全尊重用户配置的 `providerType`，不要尝试匹配内置模型的 provider。

---

## 2. AuthStorage 与 ModelRegistry

### 2.1 AuthStorage 的职责

`AuthStorage` 管理 API key 的存储和查找：

```ts
// 创建内存存储（不依赖文件系统）
const authStorage = AuthStorage.inMemory();

// 注册运行时 API key（不持久化）
authStorage.setRuntimeApiKey(providerName, apiKey);

// 查找优先级
// 1. runtimeOverrides（setRuntimeApiKey 设置的）
// 2. auth.json 文件存储
// 3. 环境变量（按 provider 名称映射）
// 4. fallbackResolver
```

### 2.2 ModelRegistry 的职责

`ModelRegistry` 管理模型列表和 auth 解析：

```ts
// 创建内存注册表（不加载 models.json）
const modelRegistry = ModelRegistry.inMemory(authStorage);

// 动态注册 provider
modelRegistry.registerProvider(providerName, {
  apiKey: 'xxx',
  baseUrl: 'https://api.example.com/v1',
  models: [{ id: 'model-id', name: 'Model Name', ... }]
});

// SDK 内部调用链
// session.prompt() → streamFn → modelRegistry.getApiKeyAndHeaders(model)
//                                              ↓
//                                authStorage.getApiKey(model.provider)
```

### 2.3 关键：provider 名称必须一致

```ts
// ❌ 错误：provider 名称不匹配
model.provider = 'openai';
authStorage.setRuntimeApiKey('openai-completions', apiKey);  // 不匹配！

// ✅ 正确：provider 名称一致
model.provider = 'openai-completions';
authStorage.setRuntimeApiKey('openai-completions', apiKey);
// 或者用 registerProvider
modelRegistry.registerProvider('openai-completions', { apiKey, ... });
```

---

## 3. 正确构造模型对象

### 3.1 完全自定义模型（推荐）

适用于：用户自行配置的任意 API 端点

```ts
const providerName = userConfig.providerType;  // 如 'openai-completions'

const model = {
  id: userConfig.modelId,
  name: userConfig.name ?? userConfig.modelId,
  api: userConfig.providerType,      // API 格式
  provider: providerName,             // 与 registerProvider 的 key 一致
  baseUrl: userConfig.baseUrl || '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
} as any;

// 注册 API key
if (userConfig.apiKey) {
  modelRegistry.registerProvider(providerName, {
    apiKey: userConfig.apiKey,
    baseUrl: userConfig.baseUrl,
    models: [{
      id: userConfig.modelId,
      name: userConfig.name ?? userConfig.modelId,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
  } as any);
}
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

// ✅ 正确：直接用用户配置
const model = {
  api: userConfig.providerType,  // 用户决定 API 格式
  provider: userConfig.providerType,
  ...
};
```

---

## 4. Direct LLM 调用（不经过 Agent）

使用 `stream()` 函数直接调用 LLM：

```ts
import { stream } from '@earendil-works/pi-ai';

const model = {
  id: 'model-id',
  api: 'openai-completions',
  provider: 'openai-completions',
  baseUrl: 'https://api.example.com/v1',
  // ... 其他字段
} as any;

// 关键：通过 options.apiKey 直接传入
const eventStream = stream(model, {
  systemPrompt: '...',
  messages: [{ role: 'user', content: [...], timestamp: Date.now() }],
}, {
  temperature: 0.3,
  signal: abortController.signal,
  apiKey: userApiKey,  // ← 直接传入，优先级最高
});

for await (const ev of eventStream) {
  if (ev.type === 'text_delta') {
    console.log(ev.delta);
  }
}
```

---

## 5. Agent Session 调用

使用 `createAgentSession` 创建带工具调用的 Agent：

```ts
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);

// 构造模型
const model = {
  id: userConfig.modelId,
  api: userConfig.providerType,
  provider: userConfig.providerType,
  baseUrl: userConfig.baseUrl,
  // ...
} as any;

// 注册 API key
modelRegistry.registerProvider(userConfig.providerType, {
  apiKey: userConfig.apiKey,
  baseUrl: userConfig.baseUrl,
  models: [{ id: userConfig.modelId, ... }],
} as any);

const { session } = await createAgentSession({
  model,
  tools: ['read', 'bash', 'edit', 'write'],
  customTools: myCustomTools,
  authStorage,      // ← 必须传入
  modelRegistry,    // ← 必须传入
  sessionManager: SessionManager.inMemory(),
  cwd: process.cwd(),
});

// 调用
await session.prompt('你的问题');
```

---

## 6. 常见陷阱

### 6.1 `process.env` 不生效

```ts
// ❌ 错误：pi-coding-agent 不读 process.env
process.env.OPENAI_API_KEY = apiKey;

// ✅ 正确：通过 AuthStorage 或 options.apiKey 传入
authStorage.setRuntimeApiKey('openai', apiKey);
// 或
stream(model, context, { apiKey });
```

### 6.2 Provider 与 API Type 混淆

```ts
// 用户配置
{ providerType: 'openai-completions', modelId: 'mistral-small-latest' }

// ❌ 错误：用 providerType 搜索内置模型
getModel('openai-completions', 'mistral-small-latest');  // 找不到

// ✅ 正确：直接构造模型，用 providerType 作为 api
const model = {
  api: 'openai-completions',  // OpenAI 兼容格式
  provider: 'openai-completions',
  ...
};
```

### 6.3 测试连接 ≠ 实际调用

配置管理页面的"测试"只是简单的 HTTP GET：

```ts
// 测试连接（不经过 pi-ai）
fetch(`${model.baseUrl}/models`, {
  headers: { 'Authorization': `Bearer ${model.apiKey}` }
});
```

实际调用需要正确的 `api` 格式和完整的 model 对象。

### 6.4 内置模型列表有限

pi-ai 内置模型列表只包含主流模型：

```ts
// 内置的
getModel('openai', 'gpt-4o');  // ✅ 找到

// 非内置的
getModel('deepseek', 'deepseek-chat');  // ❌ 找不到
getModel('openai', 'deepseek-chat');    // ❌ 找不到
```

自定义模型必须手动构造 model 对象。

---

## 7. 完整示例

```ts
// src-agent/src/agent.ts
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

export async function createAgent(bridge: BridgeClient) {
  // 1. 获取用户配置
  const userConfig = await bridge.getDefaultModel();
  if (!userConfig?.apiKey) {
    throw new Error('未配置 API Key');
  }

  // 2. 创建内存存储
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  // 3. 用用户配置的 providerType 构造模型
  const providerName = userConfig.providerType;
  const model = {
    id: userConfig.modelId,
    name: userConfig.name ?? userConfig.modelId,
    api: userConfig.providerType,
    provider: providerName,
    baseUrl: userConfig.baseUrl || '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as any;

  // 4. 注册 provider 和 API key（必须指定 api 字段）
  modelRegistry.registerProvider(providerName, {
    api: userConfig.providerType,      // ← 必须：provider 级别的 api
    apiKey: userConfig.apiKey,
    baseUrl: userConfig.baseUrl,
    models: [{
      id: userConfig.modelId,
      name: userConfig.name ?? userConfig.modelId,
      api: userConfig.providerType,    // ← 必须：model 级别的 api
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
  } as any);

  // 5. 创建 session
  const { session } = await createAgentSession({
    model,
    tools: ['read', 'bash', 'edit', 'write'],
    customTools: createCustomTools(bridge),
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd: process.cwd(),
  });

  return session;
}
```

---

## 8. 参考文件

| 文件 | 说明 |
|------|------|
| `pi-ai/dist/stream.js` | `stream()` 函数，支持 `options.apiKey` |
| `pi-ai/dist/types.d.ts` | `Model<Api>` 类型定义 |
| `pi-ai/dist/providers/mistral.js` | Mistral provider 使用 `@mistralai/mistralai` SDK |
| `pi-coding-agent/dist/core/sdk.js` | `createAgentSession()` 实现 |
| `pi-coding-agent/dist/core/auth-storage.d.ts` | AuthStorage API |
| `pi-coding-agent/dist/core/model-registry.d.ts` | ModelRegistry API |

---

**文档版本**：v1.0  
**更新日期**：2026-06-08  
**适用版本**：pi-ai 0.x, pi-coding-agent 0.78+
