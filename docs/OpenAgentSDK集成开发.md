# Open Agent SDK 集成开发深度指南

> 基于 `codeany-ai/open-agent-sdk-typescript`的源码分析与 DeepWiki 架构文档整合编写。

---

## 1. 环境安装

```bash
npm install @codeany/open-agent-sdk
# 开发运行：npx tsx examples/01-simple-query.ts
# 构建：    npm run build   (tsc → dist/)
# 监听：    npm run dev     (tsc --watch)
```

**环境变量**（`.env`）：

| 变量 | 必填 | 用途 |
|------|------|------|
| `CODEANY_API_KEY` | 是 | LLM Provider Key |
| `CODEANY_API_TYPE` | 否 | `anthropic-messages`(默认) / `openai-completions` |
| `CODEANY_MODEL` | 否 | 模型名；含 `gpt-`/`o1`/`o3`/`deepseek`/`qwen`/`mistral` 自动走 OpenAI 通道 |
| `CODEANY_BASE_URL` | 否 | 自定义端点（如 OpenRouter、本地 LLM） |

**环境要求**：Node.js >= 18.0.0，TypeScript 5.7+；`tsconfig.json` 使用 `NodeNext` 模块解析，`type: module`。

---

## 2. 核心调用入口

### 方式 A：One-shot 流式查询（适合单次任务）

```typescript
import { query } from "@codeany/open-agent-sdk";

for await (const msg of query({
  prompt: "Read package.json and tell me the project name.",
  options: {
    allowedTools: ["Read", "Grep"],
    permissionMode: "bypassPermissions",
  },
})) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if ("text" in block) console.log(block.text);
    }
  }
  if (msg.type === "tool_result") {
    console.log(`→ ${msg.result.tool_name}: ${msg.result.output}`);
  }
  if (msg.type === "result")
    console.log(`Done. Cost: $${msg.total_cost_usd?.toFixed(4)}`);
}
```

### 方式 B：Reusable Agent（多轮会话，推荐）

```typescript
import { createAgent } from "@codeany/open-agent-sdk";

const agent = createAgent({
  model: "claude-sonnet-4-6",     // 默认
  apiType: "openai-completions",  // 用 DeepSeek/OpenAI 时指定
  model: "gpt-4o",
  apiKey: "sk-...",
  baseURL: "https://api.openai.com/v1",
  maxTurns: 10,
  maxBudgetUsd: 1.0,
  persistSession: true,
  sessionId: "my-run-001",
});

const r1 = await agent.prompt("Create /tmp/hello.txt with Hello World");
const r2 = await agent.prompt("Read it back to me");
console.log(agent.getMessages().length);   // 多轮历史
await agent.close();                        // 关闭 MCP 连接 + 持久化
```

### 方式 C：直接创建 Provider（最低层）

```typescript
import { createProvider } from "@codeany/open-agent-sdk";
const provider = createProvider("openai-completions", {
  model: "gpt-4o",
  apiKey: "sk-...",
  baseURL: "https://api.openai.com/v1",
});
```

---

## 3. LLM API：Provider 层

SDK 内部通过 Provider 层抹平 Anthropic / OpenAI API 差异（`src/engine.ts` + `src/types.ts`）。

### 关键实现细节

- **Anthropic Messages API**：直接调用 `@anthropic-ai/sdk`，支持 extended thinking、prompt caching
- **OpenAI-compatible**：将 `messages.create` 适配为 `chat.completions.create`，`tool_use` → `tools(functions)` 格式映射
- **指数退避重试**：`withRetry` 处理 429/500（`src/engine.ts:206-234`）
- **Prompt 过长自动压缩**：遇到 `isPromptTooLongError` 立即触发 compaction
- **Cache 计费**：`cache_creation_input_tokens` / `cache_read_input_tokens` 单独统计（`src/utils/tokens.ts:60-63`）

### 模型定价（`src/utils/tokens.ts:99-108`）

| 模型级 | 输入（$/1M tokens） | 输出（$/1M tokens） |
|--------|---------------------|---------------------|
| Opus | $15.00 | $75.00 |
| Sonnet | $3.00 | $15.00 |
| Haiku | $0.80 | $4.00 |

> 无定价匹配时默认按 Sonnet 级别估算（`src/utils/tokens.ts:113-122`）

---

## 4. Agentic Loop 内循环机制（QueryEngine）

`QueryEngine`（`src/engine.ts`）是 SDK "大脑"，每轮 Turn 执行以下状态机：

```
┌──────────────────┐
│ buildSystemPrompt │
│  ├─ Base 指令      │
│  ├─ 工具目录        │
│  ├─ 子代理定义      │
│  ├─ Git status     │
│  ├─ AGENT.md/CLAUDE.MD 项目上下文
│  └─ cwd            │
└────────┬─────────┘
         ▼
┌──────────────────────┐
│ LLM messages.create  │
│ (tools + system +    │
│  history)            │
│ ← yield SDKPartialMessage streaming
└────────┬─────────────┘
         ▼
┌──────────────────────┐
│ 解析 Output           │
│ tool_use? ─→ dispatch │
│ text?     ─→ yield    │
└────────┬─────────────┘
         ▼
┌──────────────────────────┐
│ Tool Exec Pipeline        │
│ isReadOnly? → Promise.all │   ← 并行执行（只读工具）
│ else         → serial     │   ← 串行执行（bash/write/edit）
└────────┬─────────────────┘
         ▼
┌──────────────────────────┐
│ Context Check             │
│ estimateMessagesTokens()  │
│ > contextWindow - 13000?  │
│ ├─ YES → compactConversation()  ← LLM 摘要压缩历史
│ │         (stripImages, summarize, replace)
│ └─ NO → continue
│ + microCompactMessages()  ← single tool_result > 50000 chars trunc
└────────┬─────────────────┘
         ▼
┌──────────────────────────┐
│ Next Turn?               │
│ turnsRemaining > 0       │
│ && totalCost < maxBudget  │
│ && !stop_reason          │
└────────┬─────────────────┘
         ▼
  [return SDKResultMessage:
   subtype, total_cost_usd,
   usage, model_usage]
```

**核心参数**（`src/engine.ts`）：

| 参数 | 默认值 | 位置 | 说明 |
|------|--------|------|------|
| `maxTurns` | 10 | `engine.ts:169` | 最大 agentic 轮数 |
| `maxBudgetUsd` | ∞ | `engine.ts:173-176` | 花费上限（USD） |
| `thinking` | `{ type: 'adaptive' }` | `types.ts:260-263` | Claude extended thinking |
| `effort` | `"high"` | — | OpenAI 推理强度：`low/medium/high/max` |

**上下文窗口映射**（`src/utils/tokens.ts:68-82`）：

| 模型 | Context Window |
|------|---------------|
| Opus 1m | 1,000,000 tokens |
| Sonnet / Haiku (标准) | 200,000 |
| Claude 3 系列 | 200,000 |
| 默认 fallback | 200,000 |

**Auto-compact 阈值** = contextWindow - `AUTOCOMPACT_BUFFER_TOKENS` (13,000)。

---

## 5. 工具系统（ToolPool）

### 工具定义方式

#### ① `defineTool()` — 低层 JSON Schema（内建工具基础）

```typescript
import { defineTool, getAllBaseTools } from "@codeany/open-agent-sdk";

const calculator = defineTool({
  name: "Calculator",
  description: "Evaluate a math expression",
  inputSchema: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input) {
    const result = Function(`'use strict'; return (${input.expression})`)();
    return `${input.expression} = ${result}`;
  },
});

const agent = createAgent({ tools: [...getAllBaseTools(), calculator] });
```

#### ② `tool()` + Zod — 快速定义，自动 MCP 兼容

```typescript
import { tool, z, createSdkMcpServer } from "@codeany/open-agent-sdk";

const getWeather = tool(
  "get_weather",
  "Get the temperature for a city",
  { city: z.string().describe("City name") },
  async ({ city }) => ({
    content: [{ type: "text", text: `${city}: 22°C, sunny` }],
  }),
);

const server = createSdkMcpServer({ name: "weather", tools: [getWeather] });

await query({
  prompt: "What is the weather in Tokyo?",
  options: { mcpServers: { weather: server } },
});
```

> `tool()` 返回 `SdkMcpToolDefinition`，通过 `sdkToolToToolDefinition()` 转为内部 `ToolDefinition`（`src/tool-helper.ts:62-76`）。

### 35+ 内置工具分类（`src/tools/index.ts:68-128`）

| 类别 | 工具 |
|------|------|
| **File I/O** | Read, Write, Edit, Glob, Grep |
| **Shell** | Bash |
| **Web** | WebFetch, WebSearch |
| **Multi-agent** | Agent, SendMessage, TeamCreate/Delete |
| **Task Mgmt** | TaskCreate/List/Update/Stop/Output |
| **Workflow** | EnterWorktree/ExitWorktree, EnterPlanMode/ExitPlanMode |
| **MCP 发现** | ToolSearch, ListMcpResources, ReadMcpResource |
| **调度** | CronCreate/Delete/List |
| **其他** | LSP（语言服务协议）, Config, TodoWrite, NotebookEdit, RemoteTrigger, AskUserQuestion |

### 工具命名空间

外部 MCP 工具自动加前缀：`mcp__{serverName}__{toolName}`（`src/mcp/client.ts:94-97`），避免命名冲突。

### 执行安全规则（`src/tools/types.ts:11-51`）

| 属性 | 说明 |
|------|------|
| `isReadOnly` | 只读工具可并行执行；被 `plan` 等 restriction 模式放行 |
| `isConcurrencySafe` | 显式声明可并发安全 |
| `isEnabled` | 动态判断当前上下文是否暴露给 LLM |
| `is_error` | ToolResult 标记，API 返回给 LLM 用于错误恢复 |

---

## 6. MCP 工具集成

### 外部 MCP Server（stdio / SSE / HTTP）

```typescript
const agent = createAgent({
  mcpServers: {
    // stdio — 本地进程
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    // SSE — 长连接事件流
    remote_sse: {
      url: "https://mcp.example.com/sse",
    },
    // HTTP — 标准 HTTP 传输
    remote_http: {
      url: "https://mcp.example.com/mcp",
    },
  },
});
```

- `connectMCPServer()`（`src/mcp/client.ts:26-48`）建立连接并执行工具发现
- 每个外部连接维护 `MCPConnection` 实例，Agent 关闭时自动清理（`agent.close()`）

### In-Process MCP Server（零子进程）

```typescript
import { tool, z, createSdkMcpServer } from "@codeany/open-agent-sdk";

const getStock = tool(
  "get_stock_price",
  "Get current stock price",
  { symbol: z.string().describe("Stock symbol, e.g. AAPL") },
  async ({ symbol }) => ({ content: [{ type: "text", text: `$${symbol}: $192.50` }] }),
);

const server = createSdkMcpServer({
  name: "finance",
  tools: [getStock],
});

// 传入 options.mcpServers，工具直接进 toolPool，不经过 stdio
await query({
  prompt: "What is AAPL trading at?",
  options: { mcpServers: { finance: server } },
});
```

> `createSdkMcpServer()`（`src/sdk-mcp-server.ts:47-51`）将 Zod 工具直接包装进 SDK 内部 toolPool，避免 IPC 开销。

---

## 7. Skills（提示词模板化）

```typescript
import { registerSkill, getAllSkills } from "@codeany/open-agent-sdk";

registerSkill({
  name: "debug",
  description: "Systematic debugging using structured investigation",
  userInvocable: true,   // 允许模型通过 Skill 工具调用
  async getPrompt(args) {
    return [
      {
        type: "text",
        text: `You are a senior debugger.\n\nTask: ${args || "Investigate the current issue."}\n\nSteps:\n1. Reproduce the issue\n2. Check logs\n3. Identify root cause\n4. Propose fix`,
      },
    ];
  },
});

console.log(`${getAllSkills().length} skills registered`);
// 模型通过内置 Skill 工具按名称调用
// 内置 5 个：simplify / commit / review / debug / test
```

**Skill 机制原理**：
- `Skill` 工具是 SDK 内建工具之一，模型生成 `tool_use: Skill` 时传参 `skill: "debug"`
- SDK 将 `getPrompt(args)` 返回值作为 system/message prompt 注入新一轮 LLM 调用
- 支持动态参数透传，本质上是一种**延迟注入的 prompt template**

---

## 8. Hooks（20 个生命周期事件）

### Hook 事件目录（`src/hooks.ts:31-52`）

| 类别 | 事件 |
|------|------|
| **Tool 生命周期** | `PreToolUse` / `PostToolUse` / `PostToolUseFailure` |
| **Session** | `SessionStart` / `SessionEnd` / `Stop` |
| **多 Agent** | `SubagentStart` / `SubagentStop` / `TeammateIdle` |
| **状态变更** | `ConfigChange` / `CwdChanged` / `FileChanged` |
| **用户交互** | `UserPromptSubmit` / `PermissionRequest` / `PermissionDenied` |
| **优化** | `PreCompact` / `PostCompact` |

### 注册 Hook（TS 函数方式）

```typescript
import { createHookRegistry } from "@codeany/open-agent-sdk";

const hooks = createHookRegistry({
  PreToolUse: [
    {
      matcher: "^Bash$",      // 正则过滤 toolName
      timeout: 10000,
      handler: async (input) => {
        console.log(`[HOOK] About to run: ${input.toolName}`);
        // 返回 { block: true } 可阻止工具执行
        if (input.toolInput?.command?.includes("rm -rf")) {
          return { block: true, message: "Dangerous command blocked" };
        }
        return {};
      },
    },
  ],
  PostToolUse: [
    {
      handler: async (input) => {
        console.log(`[HOOK] ${input.toolName} completed`);
        return {};
      },
    },
  ],
  PostToolUseFailure: [
    {
      handler: async (input) => {
        console.error(`[HOOK] ${input.toolName} failed: ${input.error}`);
        return { message: `Tool failed, consider trying another approach.` };
      },
    },
  ],
  SessionStart: [{ handler: async () => initResources() }],
  PreCompact: [{ handler: async () => saveCheckpoint() }],
});
```

### HookInput / HookOutput（`src/hooks.ts:73-104`）

```typescript
// HookInput
{
  event: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  sessionId: string;
  cwd: string;
  error?: string;
}

// HookOutput（handler 返回）
{
  message?: string;             // 追加到对话历史
  block?: boolean;              // 阻止当前操作
  permissionUpdate?: {          // 动态修改权限
    toolName: string;
    behavior: "allow" | "deny";
    updatedInput?: Record<string, any>;
    message?: string;
  };
  notification?: string;        // 系统通知
}
```

### Shell Hook 协议（`src/hooks.ts:202-250`）

Hook 也支持外部 shell 命令：

```bash
# 环境变量
HOOK_EVENT=PreToolUse
HOOK_TOOL_NAME=Bash
HOOK_SESSION_ID=<uuid>
HOOK_CWD=/path/to/project

# stdin：完整 HookInput JSON
# stdout：JSON（HookOutput）或纯文本（作为 message 追加）
```

---

## 9. 权限系统（Permission Modes）

### 五种模式（`src/types.ts:197-204`）

| mode | 行为 | 适用场景 |
|------|------|---------|
| `bypassPermissions`（默认） | 全部放行，无确认 | CI/CD、自动化脚本 |
| `dontAsk` | 同 bypass | 无头环境 |
| `acceptEdits` | 允许文件写入类工具 | 预审批批处理 |
| `plan` | 仅非破坏性工具 | 规划阶段 |
| `default` | 走 `canUseTool(callback)` 逐工具确认 | 交互式使用 |

### 工具过滤

```typescript
const agent = createAgent({
  allowedTools: ["Read", "Glob", "Grep"],  // 白名单，含基本内部工具
  disallowedTools: ["Bash", "Write"],       // 黑名单
});
```

> 白名单优先：提供 `allowedTools` 时，只有列表内的工具可用。

### 细粒度权限回调

```typescript
const agent = createAgent({
  canUseTool: async (toolName, input) => {
    if (toolName === "Bash") {
      return {
        behavior: "deny",
        message: "Shell execution is disabled in this context",
      };
    }
    if (toolName === "Write") {
      // 可修改入参
      return {
        behavior: "allow",
        updatedInput: { ...input, path: `/safe/${input.path}` },
      };
    }
    return { behavior: "allow" };
  },
});
```

### 沙箱设置

```typescript
const agent = createAgent({
  sandbox: {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    excludedCommands: ["rm", "curl", "wget"],
  },
});
```

---

## 10. Sub Agents（子代理）

### 多代理委托模式

```typescript
const agent = createAgent({
  allowedTools: ["Agent"],  // parent 必须有
  agents: {
    "code-reviewer": {
      description: "Expert code reviewer. Use for security and performance audits.",
      prompt: "You are a senior code reviewer. Focus on security, performance, and maintainability.",
      tools: ["Read", "Glob", "Grep"],    // 限制工具集
      maxTurns: 5,
    },
    "explorer": {
      description: "Fast codebase explorer",
      prompt: "You are an expert codebase navigator.",
      tools: ["Read", "Glob", "Grep", "Bash"],
    },
  },
});

await agent.query('Use the "code-reviewer" agent to review src/index.ts');
```

### 实现路径（`src/tools/agent-tool.ts`）

- `AgentTool.call()`（`L105-114`）为子代理创建独立的 `QueryEngine`
- 递归保护：`Agent` 工具从子代理 toolPool 中移除（`L98`），防止无限循环
- 工具作用域：子代理仅能看到 `AgentDefinition.tools` 列表内定义的工具（`L93-95`）
- 结果流：子代理最终 `assistant` message 封装为 `ToolResult` 返回（`L147-151`）

### 内置子代理（`src/tools/agent-tool.ts:33-44`）

| 名称 | 描述 | 工具 |
|------|------|------|
| `Explore` | 代码库探索 | Read, Glob, Grep, Bash |
| `Plan` | 架构规划 | Read, Glob, Grep, Bash |

---

## 11. 上下文管理（Auto-compact & Micro-compact）

### 三层压缩策略（`src/utils/compact.ts`）

```
对话历史增长
    │
    ▼
┌────────────────────────────────────────┐
│ estimateMessagesTokens()              │
│ heuristic: ~4 chars / token (无 tiktoken) │
├────────────────┬───────────────────────┤
│ > threshold?   │ > 50000 chars?        │
│ (ctxWindow     │ (单条 tool_result)    │
│  − 13000)      │                       │
│                ▼                       │
│         ┌──────────────┐              │
│         │ Micro-compact│              │
│         │ middle-out   │              │
│         │ 截断          │              │
│         └──────────────┘              │
│                │                       │
│         ┌──────▼──────────┐           │
│         │ Auto-compact    │           │
│         │ 1. stripImages  │           │
│         │ 2. buildPrompt  │           │
│         │    (user→5000, │           │
│         │     tool→1000)  │           │
│         │ 3. LLM 摘要     │           │
│         │ 4. replace with │           │
│         │    [User(summary)│          │
│         │     + Assistant  │          │
│         │     ack]         │           │
│         └─────────────────┘           │
│                                        │
│ 断路器：consecutiveFailures ≥ 3 → 停止  │
└────────────────────────────────────────┘
```

**关键常量**（`src/utils/tokens.ts`）:
- `AUTOCOMPACT_BUFFER_TOKENS = 13000`
- `maxToolResultChars = 50000`

---

## 12. Session 持久化与 fork

```typescript
import { createAgent, listSessions, forkSession } from "@codeany/open-agent-sdk";

// 自动 UUID session
const a1 = createAgent({ persistSession: true });
await a1.prompt("Analyze monorepo structure");

// 指定 ID 继续
const a2 = createAgent({ persistSession: true, sessionId: "my-id" });
await a2.prompt("Continue analysis");

// 恢复旧会话
const a3 = createAgent({ resume: "previous-session-uuid" });

// 列出所有会话
const sessions = listSessions();

// 基于历史 fork
const branched = forkSession(sessions[0].id);
```

> 存储位置：`~/.open-agent-sdk/`（`src/session.ts:156-168`），JSON 格式。

---

## 13. Web Server 集成

```bash
npx tsx examples/web/server.ts   # → http://localhost:8081
```

内置 Express 风格 Web UI，适合本地调试。

---

## 14. SDKMessage 事件流格式

```
system(init)
  ├─ subtype: "init"
  ├─ session_id, tools, model, cwd
  │
partial_message(text / tool_use)
  ├─ partial.text
  ├─ partial.name
  └─ partial.input
  │
assistant
  ├─ message.content (Anthropic blocks)
  │
tool_result
  ├─ tool_use_id
  ├─ tool_name
  └─ output
  │
result(success | error_max_turns | error_budget_exceeded)
  ├─ total_cost_usd
  ├─ usage
  │   ├─ input_tokens
  │   ├─ output_tokens
  │   ├─ cache_creation_input_tokens
  │   └─ cache_read_input_tokens
  └─ model_usage (多代理场景分模型统计)
  │
system(status)
  └─ message (人类可读状态)
```

---

## 15. 架构总图与源码映射

```
┌──────────────────────────────────────────────────────────────┐
│                Your Application (src/)                        │
│  import { createAgent, query, tool, registerSkill }          │
└──────────────────────────┬───────────────────────────────────┘
                           │
              ┌────────────▼──────────────┐
              │  Agent Layer              │
              │  src/agent.ts:L38         │
              │  ├─ 配置解析 + 凭证 (L77) │
              │  ├─ ToolPool 组装 (L117)  │
              │  ├─ MCP 初始化 (L124-143) │
              │  ├─ Session 恢复 (L146)   │
              │  └─ query/prompt/close    │
              └────────────┬──────────────┘
                           │
              ┌────────────▼──────────────┐
              │  QueryEngine              │
              │  src/engine.ts:L139       │
              │  ├─ buildSystemPrompt     │ ← L49-108
              │  │   ├─ base + tool catalog│
              │  │   ├─ git + AGENT.md     │
              │  │   └─ cwd                │
              │  ├─ messages.create       │ ← L203-231
              │  │   └─ withRetry          │
              │  ├─ executeTools           │ ← L316-368
              │  │   ├─ isReadOnly → all  │
              │  │   └─ mutation → serial  │
              │  ├─ auto-compact          │ ← L179-192
              │  └─ micro-compact         │ ← L195-197
              └──────┬──────────────────┬─┘
                     │                  │
           ┌─────────▼──────┐   ┌──────▼───────────────┐
           │ Provider Layer │   │  ToolPool             │
           │ src/engine.ts  │   │  ├─ 35 内建           │
           │ ├─ Anthropic   │   │  ├─ defineTool()       │
           │ └─ OpenAI compat│  │  └─ MCP servers       │
           │                 │   │     ├─ stdio/SSE/HTTP  │
           │                 │   │     └─ SDK In-Process  │
           └─────────────────┘   └───────────────────────┘

生命周期横切面：
  Hooks 系统 (src/hooks.ts)
    ├─ 20 events, handler / shell-command
    ├─ HookOutput: block / message / permissionUpdate
    └─ HookRegistry.execute() (L142-182, Promise.race + timeout)

权限系统 (src/agent.ts:L186-195)
  ├─ PermissionMode: bypassPermissions / acceptEdits / plan / default
  └─ canUseTool(callback) async fn
```

---

## 16. 生产级 Starter Template

```typescript
import {
  createAgent,
  registerSkill,
  createHookRegistry,
  z,
  tool,
  createSdkMcpServer,
} from "@codeany/open-agent-sdk";

// ① 注册自定义 Skill
registerSkill({
  name: "plan",
  description: "Create a task plan for the given goal",
  userInvocable: true,
  async getPrompt(args) {
    return [
      {
        type: "text",
        text: `Create a step-by-step implementation plan for:\n\n${args || "current task"}

Requirements:
- List concrete steps
- Identify which files need changes
- Flag potential risks`,
      },
    ];
  },
});

// ② 自定义 MCP 工具
const getWeather = tool(
  "get_weather",
  "Current weather for a city",
  { city: z.string().describe("City name") },
  async ({ city }) => ({
    content: [{ type: "text", text: `${city}: 22°C, sunny` }],
  }),
);

const internalMcp = createSdkMcpServer({
  name: "internal",
  tools: [getWeather],
});

// ③ 建立 Agent
const agent = createAgent({
  model: "claude-sonnet-4-6",
  apiType: "openai-completions",
  apiKey: process.env.CODEANY_API_KEY,
  baseURL: process.env.CODEANY_BASE_URL,
  maxTurns: 15,
  maxBudgetUsd: 2.0,
  permissionMode: "bypassPermissions",
  allowedTools: [
    "Read", "Write", "Edit", "Glob", "Grep",
    "Bash", "WebFetch", "Agent",
  ],
  hooks: {
    PreToolUse: [
      {
        handler: async (input) => {
          console.log(`[TRACE] → ${input.toolName}`);
          return {};
        },
      },
    ],
    PostToolUse: [
      {
        handler: async (input) => {
          console.log(`[TRACE] ← ${input.toolName}`);
          return {};
        },
      },
    ],
  },
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
    internal: internalMcp,
  },
  agents: {
    "code-reviewer": {
      description: "Junior-level code reviewer",
      prompt: "You are a code reviewer. Flag obvious bugs and style issues.",
      tools: ["Read", "Grep"],
      maxTurns: 5,
    },
  },
  persistSession: true,
  sessionId: "prod-agent-001",
});

// ④ 运行
try {
  const result = await agent.prompt(
    "Review src/ for type errors, fix 3 issues, and create a git commit"
  );
  console.log(result.text);
  console.log(
    `\nCost: $${(result.total_cost_usd || 0).toFixed(4)}` +
    `\nTurns: ${result.num_turns}` +
    `\nTokens: ${result.usage.input_tokens + result.usage.output_tokens}`,
  );
} finally {
  await agent.close();
}
```

---

## 17. 关键源码路径索引

| 源码文件 | 关键行 | 说明 |
|----------|--------|------|
| `src/agent.ts` | `L38` | Agent 主类 constructor |
| `src/agent.ts` | `L77-91` | 凭证解析（option → env → default） |
| `src/agent.ts` | `L117-153` | setup() 生命周期（subagent / MCP / session resume） |
| `src/agent.ts` | `L158-346` | query() / prompt() / close() 接口 |
| `src/engine.ts` | `L49-108` | buildSystemPrompt() |
| `src/engine.ts` | `L139-141` | QueryEngine 主循环（AsyncGenerator） |
| `src/engine.ts` | `L169-200` | 约束检查（turns / budget / compaction） |
| `src/engine.ts` | `L203-234` | LLM 调用 + withRetry |
| `src/engine.ts` | `L316-368` | executeTools（并行 read-only / 串行 mutation） |
| `src/mcp/client.ts` | `L26-48` | connectMCPServer（stdio / SSE / HTTP） |
| `src/mcp/client.ts` | `L94-97` | 工具命名空间化 `mcp__{server}__{tool}` |
| `src/hooks.ts` | `L31-52` | HOOK_EVENTS 常量 |
| `src/hooks.ts` | `L142-182` | HookRegistry.execute() |
| `src/hooks.ts` | `L202-250` | Shell Hook 协议（stdin/stdout JSON） |
| `src/tools/agent-tool.ts` | `L33-44` | 内置子代理（Explore / Plan） |
| `src/tools/agent-tool.ts` | `L85-152` | SubAgent 委托执行 |
| `src/tools/agent-tool.ts` | `L98` | 递归保护（移除 Agent 工具） |
| `src/tools/types.ts` | `L11-51` | ToolDefinition 接口 |
| `src/tools/types.ts` | `L30-49` | ToolResult 结构 |
| `src/types.ts` | `L164-173` | ToolDefinition 类型定义 |
| `src/types.ts` | `L197-204` | PermissionMode 联合 |
| `src/types.ts` | `L211-214` | CanUseToolFn 回调签名 |
| `src/types.ts` | `L220-242` | McpServerConfig（stdio / SSE / HTTP union） |
| `src/sdk-mcp-server.ts` | `L47-51` | createSdkMcpServer（in-process） |
| `src/session.ts` | `L156-168` | 会话存储路径（`~/.open-agent-sdk/`） |
| `src/utils/compact.ts` | `L59-124` | compactConversation（LLM 摘要） |
| `src/utils/compact.ts` | `L181-206` | microCompactMessages（middle-out 截断） |
| `src/utils/compact.ts` | `L45` | 断路器：consecutiveFailures ≥ 3 停止 compaction |
| `src/utils/tokens.ts` | `L11-15` | estimateTokens：4 chars/token 启发式 |
| `src/utils/tokens.ts` | `L87-94` | AUTOCOMPACT_BUFFER_TOKENS + threshold |
| `src/utils/tokens.ts` | `L113-122` | estimateCost 定价逻辑 |

---

## 18. 依赖项与包结构

```
@codeany/open-agent-sdk@0.2.0
├── @anthropic-ai/sdk@^0.52.0   — Anthropic API 客户端
├── @modelcontextprotocol/sdk@^1.12.1  — MCP 协议（客户端 + 服务端）
├── zod@^3.23.0                  — Schema 验证
├── zod-to-json-schema@^3.24.0   — Zod → JSON Schema 转换
└── [dev] tsx@^4.19.0            — TypeScript 直接执行
```

`package.json:18-25` — ESM 导出：
```json
{
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

---

## 19. 示例项目速查

| # | 文件 | 说明 |
|---|------|------|
| 01 | `examples/01-simple-query.ts` | Streaming query 基础 |
| 02 | `examples/02-multi-tool.ts` | Glob + Bash 多工具编排 |
| 03 | `examples/03-multi-turn.ts` | 会话持久化多轮 |
| 04 | `examples/04-prompt-api.ts` | blocking prompt() API |
| 05 | `examples/05-custom-system-prompt.ts` | 自定义 system prompt |
| 06 | `examples/06-mcp-server.ts` | 外部 MCP Server |
| 07 | `examples/07-custom-tools.ts` | defineTool() 自定义工具 |
| 08 | `examples/08-official-api-compat.ts` | query() API 兼容模式 |
| 09 | `examples/09-subagents.ts` | Subagent 委托 |
| 10 | `examples/10-permissions.ts` | 只读代理 / 权限限制 |
| 11 | `examples/11-custom-mcp-tools.ts` | tool() + createSdkMcpServer() |
| 12 | `examples/12-skills.ts` | Skill 系统 |
| 13 | `examples/13-hooks.ts` | Hooks 生命周期 |
| 14 | `examples/14-openai-compat.ts` | OpenAI / DeepSeek 兼容 |
| web | `examples/web/server.ts` | Web Chat UI |

```bash
npx tsx examples/01-simple-query.ts       # 运行单个
npm run test:all                          # 全量测试
npx tsx examples/web/server.ts            # 启动 Web UI
```
