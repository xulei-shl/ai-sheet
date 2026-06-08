# 修复 LLM 调用失败问题

## Context

当前项目所有 LLM 调用均无法成功。根因是项目将 pi-ai 的 `provider`（身份标识，用于 API Key 查找）和 `api`（协议类型，如 `openai-completions`）两个概念混淆为一个 `providerType` 字段。导致：

1. **Batch Runner 完全无 API Key** — `stream()` 调用时未传 `apiKey`，环境变量查找因 provider 名错误而失败
2. **DeepSeek 用户无法使用** — `providerType='deepseek'` 被当作 `api` 类型，但 pi-ai 没有 `deepseek` 这个 API 协议，抛出 "No API provider registered for api: deepseek"
3. **Direct LLM 事件处理有误** — 未区分 `text_delta` 事件与其他事件类型，`ev?.text` 在 pi-ai 中不存在
4. **agentStore 调用了不存在的 `getMergedModels()`** — configStore 只有 `getAllModels()`

---

## 修复方案

### 1. 新建 `provider-map.ts` — provider/api 映射模块

**文件**: `src-agent/src/provider-map.ts`（新建）

创建 `providerType → (provider, api)` 的映射表，统一解决三个文件中的 provider/api 混淆：

```
providerType              → { provider,           api }
──────────────────────────────────────────────────────────
'openai-completions'      → { 'openai',           'openai-completions' }
'openai-responses'        → { 'openai',           'openai-responses' }
'anthropic-messages'      → { 'anthropic',        'anthropic-messages' }
'deepseek'                → { 'deepseek',         'openai-completions' }   ← 关键！
'mistral-conversations'   → { 'mistral',          'mistral-conversations' }
'google-generative-ai'   → { 'google',           'google-generative-ai' }
```

导出：
- `resolveProviderApi(providerType: string): { provider: string; api: string }` — 未知类型 heuristic fallback
- `buildModel(info: { providerType: string; modelId: string; name?: string; baseUrl?: string }): any` — 统一构造 model 对象

### 2. 修复 `agent.ts` — 正确拆分 provider/api

**文件**: `src-agent/src/agent.ts`

- 用 `resolveProviderApi()` 替代 `provider: providerName` 的直接赋值
- `model.api` = 解析后的 api（如 `'openai-completions'`）
- `model.provider` = 解析后的 provider（如 `'deepseek'`）
- `registerProvider()` 注册时使用正确的 `provider` 和 `api`

### 3. 修复 `direct-llm.ts` — 正确拆分 + 事件处理

**文件**: `src-agent/src/direct-llm.ts`

- 用 `buildModel()` 替代手动构造 model 对象
- 修复事件处理循环：只处理 `ev.type === 'text_delta'` 时提取 delta
- 移除不存在的 `ev?.text` fallback

### 4. 修复 `batch/runner.ts` — 传递 apiKey + 正确拆分

**文件**: `src-agent/src/batch/runner.ts`

- `BatchRunParams` 接口增加 `apiKey?: string` 和 `baseUrl?: string`
- `_resolveModel()` 使用 `resolveProviderApi()` 正确拆分
- `_callLLM()` 传入 `apiKey` 到 `stream()` 的 options
- `_processRowWithRetry()` 和 `run()` 方法透传 apiKey

### 5. 修复 `main.ts` — batch_start 时补充 apiKey

**文件**: `src-agent/src/main.ts`

- `handleBatchStart()` 中从 `bridge.getDefaultModel()` 获取 apiKey 和 baseUrl，合并到 batch params
- 修复 undici fetch override：对 `127.0.0.1` / `localhost` 请求使用原始 fetch，避免本地 HTTP 调用受不必要超时影响

### 6. 修复 `configStore.ts` — 添加 `getMergedModels` 方法

**文件**: `src/stores/configStore.ts`

- 添加 `getMergedModels()` 方法（等同于 `getAllModels()` 的别名，名称更准确因为包含了 secure store 中的 API Key）
- 或直接将 `getAllModels` 重命名为 `getMergedModels`

### 7. 扩展 `ConfigPage.tsx` — 增加 provider 选项

**文件**: `src/pages/ConfigPage.tsx`

- `PROVIDER_OPTIONS` 增加：`deepseek`、`mistral-conversations`、`google-generative-ai`
- 对应更新 `BASE_URL_PLACEHOLDERS` 和 `MODEL_ID_PLACEHOLDERS`

---

## 实施顺序

1. `provider-map.ts`（基础模块）
2. `agent.ts`（引用 provider-map）
3. `direct-llm.ts`（引用 provider-map + 事件处理）
4. `batch/runner.ts` + `main.ts`（apiKey 透传 + 引用 provider-map）
5. `configStore.ts`（前端修复）
6. `ConfigPage.tsx`（UI 扩展）

## 验证方式

1. `cd src-agent && npx tsc --noEmit` — 类型检查通过
2. `cd src-agent && npm run build` — 构建成功
3. 启动应用，配置一个 OpenAI 兼容模型，在右栏 Agent 面板发送消息 → 应收到流式回复
4. 点击快捷 LLM 按钮（公式生成/提示词生成）→ 应收到流式回复
5. 在中栏批量处理页面启动批量任务 → 应逐行处理并写入结果
6. 配置 DeepSeek 模型测试 → 应正常工作
