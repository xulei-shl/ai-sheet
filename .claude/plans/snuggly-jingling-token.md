# 修复前端 LLM API 调用 CORS 问题

## Context

前端使用浏览器原生 `fetch` 调用外部 LLM API，在 Tauri webview 中受 CORS 限制。标准官方 API（如 `api.openai.com`、`api.deepseek.com`）**本身返回 CORS 头**，所以目前能正常工作。但本地部署的非标准 API（如 `http://10.40.92.18:8800`）不返回 CORS 头，导致 "Failed to fetch"。

**核心要求**：改动不能影响标准 AI API 的正常工作。

## 根因

- `openaiClient.ts` 和 `configStore.testConnection()` 都使用浏览器原生 `fetch`
- Tauri webview 执行 CORS 检查，无 `Access-Control-Allow-Origin` 头的响应被拦截
- Python aiohttp 不受 CORS 限制，所以同样的 API 在 Python 中正常

## 方案：用 `tauri-plugin-http` 替换原生 fetch

`tauri-plugin-http` 让 HTTP 请求走 Rust 后端，完全绕过浏览器 CORS。**对所有 API（标准和非标准）行为一致**，不会影响现有功能。

### 为什么安全？

1. **标准 API（openai.com 等）**：原本通过浏览器 fetch 能工作（它们有 CORS 头），改用 tauri-plugin-http 后同样能工作（Rust 后端发请求，无 CORS 限制）
2. **非标准 API（本地部署）**：原本因 CORS 失败，改用 tauri-plugin-http 后能正常工作
3. **请求格式完全不变**：只是 fetch 的实现从浏览器换到 Rust，URL、Header、Body 都一样

### 具体步骤

#### Step 1: 安装 tauri-plugin-http

**Cargo.toml** — 添加依赖：
```toml
tauri-plugin-http = "2"
```

**package.json** — 添加 npm 包：
```
@tauri-apps/plugin-http
```

#### Step 2: 注册插件

**src-tauri/src/lib.rs** — 在 `run()` 中注册：
```rust
.plugin(tauri_plugin_http::init())
```

#### Step 3: 添加权限

**src-tauri/capabilities/default.json** — 添加 http 权限：
```json
"http:default",
"http:allow-fetch",
"http:allow-fetch-cancel",
"http:allow-fetch-read-body",
"http:allow-fetch-send"
```

#### Step 4: 修改 `openaiClient.ts`

将浏览器 `fetch` 替换为 `@tauri-apps/plugin-http` 的 `fetch`：

```ts
import { fetch } from '@tauri-apps/plugin-http';

// 其余代码不变，仅将原生 fetch 替换为 plugin-http 的 fetch
```

**关键差异**：plugin-http 的 `fetch` 签名与原生 fetch 兼容，但请求走 Rust 后端，不受 CORS 限制。

#### Step 5: 修改 `configStore.ts` 的 `testConnection`

同样将 `fetch` 替换为 plugin-http 的 `fetch`：

```ts
import { fetch } from '@tauri-apps/plugin-http';

testConnection: async (model) => {
  try {
    const response = await fetch(`${model.baseUrl}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${model.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? null : `HTTP ${response.status}: ${response.statusText}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
},
```

## 修改文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src-tauri/Cargo.toml` | 添加 `tauri-plugin-http = "2"` |
| 修改 | `package.json` | 添加 `@tauri-apps/plugin-http` |
| 修改 | `src-tauri/src/lib.rs` | 注册 `.plugin(tauri_plugin_http::init())` |
| 修改 | `src-tauri/capabilities/default.json` | 添加 http 权限 |
| 修改 | `src/services/openaiClient.ts` | `fetch` 改为从 plugin-http 导入 |
| 修改 | `src/stores/configStore.ts` | `testConnection` 的 `fetch` 改为从 plugin-http 导入 |

## 验证

1. `npm install` 安装新依赖
2. `cargo build` 确认 Rust 编译通过
3. 启动应用 → 配置页面 → 测试 `http://10.40.92.18:8800/v1` → 应成功
4. 测试标准 API（如 `https://api.deepseek.com/v1`）→ 应仍然成功
5. LLM 批处理页面 → 用本地 API 运行批处理 → 应正常返回结果
