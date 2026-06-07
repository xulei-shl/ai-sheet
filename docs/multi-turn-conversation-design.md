# AI-Sheet pi-Agent 集成设计

> 用 pi-agent SDK 替代自研多轮对话系统，实现 AI Agent 驱动的数据处理

---

## 一、设计原则

| 原则 | 说明 |
|------|------|
| 不重复造轮子 | pi-agent 已提供多轮对话、流式输出、工具调用、上下文压缩、会话持久化，直接使用 |
| Rust 做数据，Node 做智能 | Rust 负责桌面能力和数据 I/O，Node.js (pi-agent) 负责 LLM 和对话 |
| 三栏联动 | 右栏 Agent 对话与中栏数据窗口实时联动 |
| 工具即接口 | pi-agent 自定义工具是 Node.js 调用 Rust 的唯一通道 |

---

## 二、pi-agent 能力映射

### 2.1 自研方案 vs pi-agent

| 原自研方案 | pi-agent 替代 | 收益 |
|-----------|--------------|------|
| Rust ConversationService（会话 CRUD + 压缩 + 归档） | AgentSession + SessionManager | 内置完整的会话生命周期管理 |
| SQLite conversations + conversation_messages 表 | JSONL 树状持久化 | 支持分支导航，无需自建表 |
| 自研 SSE 流式解析（reqwest + 手动解析） | EventStream（push-based async iterable） | 三种 delta：text/thinking/toolcall |
| 自研上下文压缩（10 轮窗口 + LLM 摘要） | Auto-Compaction（token 阈值 + 迭代摘要 + 分片压缩） | 更智能的压缩策略，支持分支摘要 |
| 自研工具调度框架 | AgentTool + Agent Loop | 工具参数校验、并发/顺序执行、hook 拦截 |
| Python Sidecar（JSON-RPC 通信） | bash 工具 + Agent Loop 自动修复 | 无需维护独立进程，Agent 自主迭代 |
| 自研 ChatStore + useChatStream | agentStore + Tauri Events 桥接 | 状态管理大幅简化 |

### 2.2 功能与 pi-agent 能力对应

| 功能 | pi-agent 机制 | 工具 |
|------|-------------|------|
| 公式生成 | 多轮对话 → Agent 思考 → 调用 apply_formula | read_excel, apply_formula |
| 提示词生成 | 多轮对话 → Agent 思考 → 调用 save_prompt | get_prompts, save_prompt |
| Python 代码执行 | 多轮对话 → 生成代码 → bash 执行 → 失败自动修复 | bash, read_excel, write_excel |
| 批量 LLM 处理 | Agent 配置 → BatchRunner（复用 pi-ai Provider） | start_batch, get_batch_status |
| 配置辅助 | 多轮对话 → 调用 test_connection | get_config, test_connection |

---

## 三、自定义工具设计

### 3.1 工具清单

| 工具名 | 类别 | 说明 | 调用 Rust API |
|--------|------|------|--------------|
| `read_excel` | Excel | 读取文件信息/列数据/样本 | `/api/excel/info`, `/api/excel/columns`, `/api/excel/sample` |
| `write_excel` | Excel | 写入处理结果 | `/api/excel/write` |
| `apply_formula` | Excel | 应用公式到列 | `/api/excel/apply-formula` |
| `get_processing_status` | Excel | 获取断点续传状态 | `/api/excel/processing-status` |
| `get_config` | Config | 获取模型配置列表 | `/api/config/models` |
| `get_default_model` | Config | 获取默认模型 | `/api/config/default` |
| `test_connection` | Config | 测试 API 连接 | `/api/config/test` |
| `get_prompts` | Prompt | 获取提示词列表 | `/api/prompts` |
| `save_prompt` | Prompt | 保存提示词 | `/api/prompts` |
| `start_batch` | Batch | 启动批量处理 | 内部（Node.js BatchRunner） |
| `pause_batch` | Batch | 暂停批量处理 | 内部 |
| `resume_batch` | Batch | 继续批量处理 | 内部 |
| `stop_batch` | Batch | 停止批量处理 | 内部 |
| `get_batch_status` | Batch | 获取批量处理状态 | 内部 |

### 3.2 工具详细定义

```typescript
// src-agent/tools/excel-tools.ts

export function excelTools(bridge: BridgeClient) {
  return [

    defineTool({
      name: 'read_excel',
      description: '读取 Excel 文件。支持三种操作：info(文件概览)、columns(指定列数据)、sample(样本数据)',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('info'),
          Type.Literal('columns'),
          Type.Literal('sample'),
        ]),
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.Optional(Type.String({ description: 'Sheet 名称（columns/sample 必填）' })),
        columns: Type.Optional(Type.Array(Type.String(), { description: '列名列表（columns 操作必填）' })),
        rows: Type.Optional(Type.Number({ description: '样本行数，默认 5', minimum: 1, maximum: 50 })),
      }),
      execute: async (_id, params) => {
        const endpoint = `/api/excel/${params.action}`;
        const result = await bridge.post(endpoint, params);
        return {
          output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          success: true,
        };
      },
    }),

    defineTool({
      name: 'write_excel',
      description: '将处理结果写入 Excel 文件。每条结果包含行号和值。支持增量写入。',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        result_column: Type.String({ description: '结果写入的列名' }),
        results: Type.Array(Type.Object({
          row: Type.Number({ description: '行号（从 1 开始）' }),
          value: Type.String({ description: '写入值' }),
        }), { description: '写入数据' }),
      }),
      execute: async (_id, params) => {
        await bridge.post('/api/excel/write', params);
        return {
          output: `已写入 ${params.results.length} 条结果到 ${params.result_column} 列`,
          success: true,
        };
      },
    }),

    defineTool({
      name: 'apply_formula',
      description: '将 Excel 公式应用到指定列的所有行。公式中使用行号引用（如 A2, B2）。',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        target_column: Type.String({ description: '公式结果写入的目标列名' }),
        formula: Type.String({ description: 'Excel 公式，如 =CONCATENATE(A2, "-", B2)' }),
        start_row: Type.Optional(Type.Number({ description: '起始行号，默认 2' })),
        end_row: Type.Optional(Type.Number({ description: '结束行号，默认最后一行' })),
      }),
      execute: async (_id, params) => {
        await bridge.post('/api/excel/apply-formula', params);
        return {
          output: `公式 ${params.formula} 已应用到 ${params.target_column} 列`,
          success: true,
        };
      },
    }),

    defineTool({
      name: 'get_processing_status',
      description: '获取 Excel 文件中某列的处理状态，用于断点续传',
      parameters: Type.Object({
        path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        result_column: Type.String({ description: '结果列名' }),
      }),
      execute: async (_id, params) => {
        const result = await bridge.post('/api/excel/processing-status', params);
        return {
          output: JSON.stringify(result, null, 2),
          success: true,
        };
      },
    }),

  ];
}
```

```typescript
// src-agent/tools/prompt-tools.ts

export function promptTools(bridge: BridgeClient) {
  return [

    defineTool({
      name: 'get_prompts',
      description: '获取提示词模板列表，可按类别过滤',
      parameters: Type.Object({
        category: Type.Optional(Type.Union([
          Type.Literal('formula'),
          Type.Literal('code'),
          Type.Literal('extraction'),
          Type.Literal('engineering'),
          Type.Literal('other'),
        ])),
      }),
      execute: async (_id, params) => {
        const result = await bridge.get('/api/prompts', params);
        return {
          output: JSON.stringify(result, null, 2),
          success: true,
        };
      },
    }),

    defineTool({
      name: 'save_prompt',
      description: '保存或更新提示词模板',
      parameters: Type.Object({
        name: Type.String({ description: '提示词名称' }),
        content: Type.String({ description: '提示词内容' }),
        category: Type.Union([
          Type.Literal('formula'),
          Type.Literal('code'),
          Type.Literal('extraction'),
          Type.Literal('engineering'),
          Type.Literal('other'),
        ], { description: '提示词类别' }),
        id: Type.Optional(Type.String({ description: '已有提示词 ID（更新时提供）' })),
      }),
      execute: async (_id, params) => {
        const result = await bridge.post('/api/prompts', params);
        return {
          output: `提示词 "${params.name}" 已保存，分类：${params.category}`,
          success: true,
        };
      },
    }),

  ];
}
```

```typescript
// src-agent/tools/batch-tools.ts

export function batchTools(bridge: BridgeClient, batchRunner: BatchRunner) {
  return [

    defineTool({
      name: 'start_batch',
      description: '启动批量 AI 处理。对 Excel 数据逐行调用 LLM，将结果写入新列。',
      parameters: Type.Object({
        file_path: Type.String({ description: 'Excel 文件路径' }),
        sheet: Type.String({ description: 'Sheet 名称' }),
        input_columns: Type.Array(Type.String(), { description: '输入列名' }),
        result_column: Type.String({ description: '结果写入列名' }),
        system_prompt: Type.String({ description: '系统提示词' }),
        combined_separator: Type.Optional(Type.String({ description: '多列拼接分隔符，默认 "|||"' })),
        temperature: Type.Optional(Type.Number({ description: '温度，默认 0.7', minimum: 0, maximum: 2 })),
      }),
      execute: async (_id, params) => {
        batchRunner.run(params);
        return {
          output: `批量处理已启动：${params.input_columns.join(', ')} → ${params.result_column}`,
          success: true,
        };
      },
    }),

    defineTool({
      name: 'get_batch_status',
      description: '获取当前批量处理的状态和进度',
      parameters: Type.Object({}),
      execute: async () => {
        const status = batchRunner.getStatus();
        return {
          output: JSON.stringify(status, null, 2),
          success: true,
        };
      },
    }),

    defineTool({
      name: 'stop_batch',
      description: '停止当前批量处理',
      parameters: Type.Object({}),
      execute: async () => {
        batchRunner.abort();
        return { output: '批量处理已停止', success: true };
      },
    }),

  ];
}
```

---

## 四、系统提示词设计

### 4.1 通用系统提示词

```typescript
// src-agent/prompts/system.ts

export function buildSystemPrompt(context?: AgentContext): string {
  return `你是 AI-Sheet，一个专业的 Excel 智能数据处理助手。

## 核心能力

1. **公式生成**：根据用户需求生成 Excel 公式，支持多轮澄清
2. **提示词工程**：帮助创建和优化大模型提示词模板
3. **Python 代码执行**：编写并执行 Python 脚本处理数据
4. **批量 AI 处理**：对 Excel 数据逐行调用 AI 处理文本

## 工具使用指南

| 场景 | 推荐工具 |
|------|---------|
| 查看 Excel 数据 | read_excel (action: info/columns/sample) |
| 写入处理结果 | write_excel |
| 应用 Excel 公式 | apply_formula |
| 查看处理进度 | get_processing_status |
| 执行 Python 代码 | bash (python script.py) |
| 保存提示词模板 | save_prompt |
| 批量 AI 处理 | start_batch |

## 工作流程

### 公式生成
1. 用 read_excel 了解数据结构
2. 与用户确认需求细节
3. 生成公式并用 apply_formula 应用
4. 询问用户是否需要调整

### Python 代码执行
1. 用 read_excel 了解数据结构
2. 编写 Python 代码并保存为文件
3. 用 bash 执行 (python script.py)
4. 如果失败，分析错误并修复代码
5. 重复直到成功

### 提示词生成
1. 了解用户需求
2. 提出关键问题（输出格式、语言、边界情况）
3. 生成提示词草稿
4. 根据用户反馈迭代优化
5. 用 save_prompt 保存

### 批量 AI 处理
1. 用 read_excel 确认数据
2. 帮用户配置提示词和参数
3. 用 start_batch 启动处理
4. 监控进度，处理异常

## 当前上下文
${context ? formatContext(context) : '（暂无数据，请先在左侧上传 Excel 文件）'}`;
}

function formatContext(ctx: AgentContext): string {
  const lines = [
    `- 当前功能：${ctx.currentTab}`,
  ];
  if (ctx.loadedFiles.length > 0) {
    lines.push(`- 已加载文件：${ctx.loadedFiles.join(', ')}`);
  }
  if (ctx.selectedColumns.length > 0) {
    lines.push(`- 选中列：${ctx.selectedColumns.join(', ')}`);
  }
  if (ctx.sampleDataPreview) {
    lines.push(`- 数据预览：\n${ctx.sampleDataPreview}`);
  }
  return lines.join('\n');
}
```

### 4.2 功能上下文模板

```typescript
// src-agent/prompts/contexts.ts

export const TAB_CONTEXTS: Record<string, string> = {
  'data/upload': '用户正在上传和选择 Excel 数据。帮助他们理解数据结构，建议选择哪些列。',
  'data/formula-gen': '用户需要生成 Excel 公式。先了解数据结构，再通过对话明确需求，最后生成公式。',
  'data/formula-proc': '用户正在批量应用公式。监控处理进度，帮助调整公式。',
  'ai/prompt-gen': '用户需要创建或优化提示词。通过多轮对话理解需求，生成高质量提示词。',
  'ai/llm-batch': '用户正在配置批量 AI 处理。帮助他们选择合适的提示词和参数，启动和监控处理。',
  'ai/python': '用户需要用 Python 处理数据。编写代码、执行、修复错误，直到成功。',
  'admin/config': '用户正在管理模型配置。帮助他们测试连接、选择合适的模型。',
  'admin/prompts': '用户正在管理提示词库。帮助他们编辑、分类和优化提示词。',
};
```

---

## 五、Agent 通信协议

### 5.1 Sidecar 通信流程

```
Rust ←→ Node.js Sidecar 通信协议（JSONL over stdin/stdout）

═══ Rust → Node.js (stdin) ═══

// 用户发送消息
{ "type": "message", "content": "帮我统计销售额" }

// 上下文更新（Tab 切换/数据变更）
{ "type": "steer", "context": { "currentTab": "data/formula-gen", "loadedFiles": [...], "selectedColumns": [...] } }

// 停止流式输出
{ "type": "stop_stream" }

// 关闭 Sidecar
{ "type": "shutdown" }

═══ Node.js → Rust (stdout) ═══

// Sidecar 启动完成
{ "type": "ready", "sessionId": "..." }

// 流式文本片段
{ "type": "text_delta", "content": "=SUMIF" }

// 流式文本完成
{ "type": "text_done", "content": "=SUMIF(Sheet1!B:B, \"华东\", Sheet1!A:A)" }

// 工具调用开始
{ "type": "tool_start", "tool": "read_excel", "args": { "action": "info", "path": "test.xlsx" }, "callId": "..." }

// 工具调用完成
{ "type": "tool_end", "tool": "read_excel", "callId": "...", "result": "..." }

// 一轮对话完成
{ "type": "turn_end" }

// 批量处理进度
{ "type": "batch_progress", "current": 50, "total": 100, "success": 48, "failed": 2, "speed": 12.5 }

// 批量处理单行完成
{ "type": "batch_row_complete", "row": 50, "result": "..." }

// 批量处理完成
{ "type": "batch_done", "stats": { "total": 100, "success": 96, "failed": 4, "duration_sec": 480 } }

// 错误
{ "type": "error", "message": "..." }
```

### 5.2 Node.js Sidecar 主入口

```typescript
// src-agent/main.ts
import { createInterface } from 'readline';
import { createSheetAgent } from './agent';
import { BatchRunner } from './batch/runner';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

async function main() {
  const bridgePort = parseInt(process.argv.find(a => a.startsWith('--bridge-port='))?.split('=')[1] || '0');
  const { session, bridge } = await createSheetAgent(bridgePort);
  const batchRunner = new BatchRunner(bridge, session);

  // stdin 读取
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    try {
      const msg = JSON.parse(line);
      await handleMessage(session, batchRunner, msg);
    } catch (e) {
      writeOutput({ type: 'error', message: String(e) });
    }
  });

  // 通知 Rust 已就绪
  writeOutput({ type: 'ready', sessionId: session.id });
}

async function handleMessage(session: AgentSession, batchRunner: BatchRunner, msg: any) {
  switch (msg.type) {
    case 'message': {
      // 订阅 Agent 事件并转发到 stdout
      const unsub = session.subscribe((event) => {
        forwardEvent(event);
      });

      try {
        await session.prompt(msg.content, { streamingBehavior: 'steer' });
      } finally {
        unsub();
        writeOutput({ type: 'turn_end' });
      }
      break;
    }
    case 'steer': {
      session.steer({
        role: 'user',
        content: `[上下文更新] ${JSON.stringify(msg.context)}`,
      }, { drainMode: 'all' });
      break;
    }
    case 'stop_stream': {
      session.abort();
      break;
    }
    case 'shutdown': {
      process.exit(0);
      break;
    }
  }
}

function forwardEvent(event: AgentSessionEvent) {
  switch (event.type) {
    case 'message_update':
      if (event.update.type === 'text_delta') {
        writeOutput({ type: 'text_delta', content: event.update.text });
      } else if (event.update.type === 'toolcall_start') {
        writeOutput({ type: 'tool_start', tool: event.update.name, args: event.update.arguments, callId: event.update.id });
      } else if (event.update.type === 'toolcall_end') {
        writeOutput({ type: 'tool_end', tool: event.update.name, callId: event.update.id, result: event.update.result });
      }
      break;
    case 'message_complete':
      writeOutput({ type: 'text_done', content: event.message.content });
      break;
  }
}

function writeOutput(obj: object) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

main().catch(e => {
  writeOutput({ type: 'error', message: String(e) });
  process.exit(1);
});
```

---

## 六、批量处理设计

### 6.1 为什么批量处理不走 Agent Loop

| 对比项 | Agent Loop 驱动 | BatchRunner（独立模块） |
|--------|----------------|----------------------|
| 1000 行开销 | 1000 次工具调度 + Agent 思考 | 直接循环，无工具调度开销 |
| 速度 | ~30秒/行（含 Agent 思考） | ~3秒/行（纯 LLM 调用） |
| 进度控制 | 需 Agent 主动暂停 | 内置暂停/续传/停止 |
| 适用场景 | 少量交互式处理 | 大批量自动化处理 |

### 6.2 BatchRunner 实现

```typescript
// src-agent/batch/runner.ts
import { stream } from '@earendil-works/pi-ai';

export class BatchRunner {
  private running = false;
  private paused = false;
  private abortController: AbortController | null = null;

  constructor(private bridge: BridgeClient, private session: AgentSession) {}

  async run(params: BatchParams) {
    this.running = true;
    this.abortController = new AbortController();

    // 获取模型配置
    const modelConfig = await this.bridge.get('/api/config/default');

    // 获取 Excel 数据
    const data = await this.bridge.post('/api/excel/columns', {
      path: params.file_path,
      sheet: params.sheet,
      columns: params.input_columns,
    });

    // 获取断点续传状态
    const status = await this.bridge.post('/api/excel/processing-status', {
      path: params.file_path,
      sheet: params.sheet,
      result_column: params.result_column,
    });

    const startRow = status.processedCount || 0;

    for (let i = startRow; i < data.rows.length; i++) {
      // 暂停检查
      while (this.paused) {
        await new Promise(r => setTimeout(r, 500));
      }
      // 停止检查
      if (this.abortController.signal.aborted) break;

      const row = data.rows[i];
      const inputText = params.input_columns
        .map(col => row[col])
        .join(params.combined_separator || '|||');

      // 直接用 pi-ai Provider 调用 LLM
      const result = await stream({
        model: modelConfig,
        messages: [
          { role: 'system', content: params.system_prompt },
          { role: 'user', content: inputText },
        ],
        temperature: params.temperature ?? 0.7,
      });

      const content = await result.text();

      // 写入结果
      await this.bridge.post('/api/excel/write', {
        path: params.file_path,
        sheet: params.sheet,
        result_column: params.result_column,
        results: [{ row: i + 1, value: content }],
      });

      // 上报进度
      writeOutput({
        type: 'batch_progress',
        current: i + 1,
        total: data.rows.length,
        success: i + 1 - (status.failedCount || 0),
        failed: status.failedCount || 0,
        speed: (i + 1 - startRow) / ((Date.now() - startTime) / 60000),
      });
    }

    this.running = false;
    writeOutput({ type: 'batch_done', stats: { /* ... */ } });
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }
  abort() { this.abortController?.abort(); }

  getStatus() {
    return { running: this.running, paused: this.paused };
  }
}
```

---

## 七、上下文管理策略

### 7.1 pi-agent Auto-Compaction

pi-agent 内置上下文压缩，无需自研：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `contextWindow` | 模型默认 | 模型上下文窗口大小 |
| `reserveTokens` | 16384 | 预留给新回复的 token 数 |
| `keepRecentTokens` | 20000 | 保留最近消息的 token 数 |

**触发条件**：`contextTokens > contextWindow - reserveTokens`

**压缩流程**：
1. 从最新消息反向遍历，累积 token 数
2. 当累积 >= `keepRecentTokens` 时，找到最近的有效切分点
3. 对被裁切的消息生成结构化摘要
4. 摘要作为 CompactionEntry 插入，后续 LLM 调用可见
5. 重复压缩时，旧摘要作为上下文传给摘要 LLM，生成增量摘要

### 7.2 Steering Message 上下文注入

当用户切换 Tab 或数据变更时，Rust 发送 steering message：

```typescript
// 触发时机
// 1. 用户切换左侧 Tab
// 2. 用户上传/移除 Excel 文件
// 3. 用户选择/取消选择列
// 4. 批量处理完成

interface AgentContext {
  currentTab: string;
  loadedFiles: string[];
  selectedColumns: string[];
  sampleDataPreview?: string;  // 最多 20 行 Markdown 表格
}
```

**设计原则**：
- Steering message 不打断当前对话流
- 使用 `session.steer()` 注入，pi-agent 会在当前轮次结束后处理
- 上下文信息精简（避免占用过多 token）

### 7.3 数据预览格式

注入到上下文的 Excel 数据预览采用 Markdown 表格格式：

```markdown
| 序号 | 题名 | 作者 | 日期 |
|------|------|------|------|
| 1 | 论信息技术的发展 | 张三, 李四 | 2024-01-15 |
| 2 | 人工智能应用研究 | 王五 | 2024-02-20 |
| ... | (共 100 行) | | |
```

限制为 20 行以控制 token 消耗。完整数据通过 `read_excel` 工具按需获取。

---

## 八、前端集成

### 8.1 agentStore 设计

```typescript
// stores/agentStore.ts

interface AgentStore {
  // State
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingContent: string;
  currentToolCalls: ToolCall[];
  isReady: boolean;
  error: string | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearConversation: () => Promise<void>;

  // 内部事件处理
  _handleStreamChunk: (chunk: StreamChunk) => void;
  _handleStreamDone: (content: string) => void;
  _handleToolStart: (call: ToolCall) => void;
  _handleToolEnd: (tool: string, callId: string, result: string) => void;
  _handleTurnEnd: () => void;
  _handleError: (message: string) => void;

  // 事件订阅
  subscribeToEvents: () => () => void;
}

const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  currentToolCalls: [],
  isReady: false,
  error: null,

  sendMessage: async (content: string) => {
    const { isReady } = get();
    if (!isReady) return;

    // 添加用户消息
    set(state => ({
      messages: [...state.messages, {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }],
      isStreaming: true,
      streamingContent: '',
    }));

    await invoke('send_agent_message', { content });
  },

  stopStreaming: () => {
    invoke('stop_agent_stream');
    set({ isStreaming: false });
  },

  _handleStreamChunk: (chunk) => {
    set(state => ({ streamingContent: state.streamingContent + chunk.content }));
  },

  _handleStreamDone: (content) => {
    set(state => ({
      messages: [...state.messages, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        toolCalls: [...state.currentToolCalls],
        timestamp: new Date().toISOString(),
      }],
      isStreaming: false,
      streamingContent: '',
      currentToolCalls: [],
    }));
  },

  _handleToolStart: (call) => {
    set(state => ({
      currentToolCalls: [...state.currentToolCalls, { ...call, status: 'running' }],
    }));
  },

  _handleToolEnd: (tool, callId, result) => {
    set(state => ({
      currentToolCalls: state.currentToolCalls.map(tc =>
        tc.callId === callId ? { ...tc, status: 'completed', result } : tc
      ),
    }));
  },

  subscribeToEvents: () => {
    const unlisten = Promise.all([
      listen<StreamChunk>('agent-stream-chunk', e => get()._handleStreamChunk(e.payload)),
      listen<string>('agent-stream-done', e => get()._handleStreamDone(e.payload)),
      listen<ToolCall>('agent-tool-start', e => get()._handleToolStart(e.payload)),
      listen<any>('agent-tool-end', e => get()._handleToolEnd(e.payload.tool, e.payload.callId, e.payload.result)),
      listen<void>('agent-turn-end', () => get()._handleTurnEnd()),
      listen<string>('agent-error', e => get()._handleError(e.payload)),
      listen<void>('sidecar-ready', () => set({ isReady: true })),
    ]);
    return () => unlisten.then(fns => fns.forEach(fn => fn()));
  },
}));
```

### 8.2 useAgentChat Hook

```typescript
// hooks/useAgentChat.ts

export function useAgentChat() {
  const sendMessage = useAgentStore(s => s.sendMessage);
  const stopStreaming = useAgentStore(s => s.stopStreaming);
  const isStreaming = useAgentStore(s => s.isStreaming);
  const messages = useAgentStore(s => s.messages);
  const streamingContent = useAgentStore(s => s.streamingContent);
  const isReady = useAgentStore(s => s.isReady);

  // 初始化事件订阅
  useEffect(() => {
    const unsub = useAgentStore.getState().subscribeToEvents();
    return () => { unsub(); };
  }, []);

  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    isReady,
    messages,
    streamingContent,
  };
}
```

### 8.3 中栏-右栏联动

```typescript
// 当中栏数据变更时，通知 Agent
function useExcelAgentSync() {
  const { files, selections } = useExcelStore();
  const currentTab = useUiStore(s => s.currentTab);

  useEffect(() => {
    const context: AgentContext = {
      currentTab,
      loadedFiles: files.map(f => f.path),
      selectedColumns: selections.flatMap(s => s.columns),
    };
    invoke('steer_agent', { context });
  }, [files, selections, currentTab]);
}
```

```typescript
// 当 Agent 工具调用改变了数据，刷新中栏
listen('agent-tool-end', (event) => {
  const { tool } = event.payload;
  // 如果是写操作，刷新 Excel 数据
  if (['write_excel', 'apply_formula'].includes(tool)) {
    useExcelStore.getState().refresh();
  }
});
```

---

## 九、会话管理

### 9.1 pi-agent SessionManager

pi-agent 提供两种 SessionManager：

| 模式 | 适用场景 | 持久化 |
|------|---------|--------|
| `SessionManager.inMemory()` | 默认，内存中管理 | 无（进程退出丢失） |
| `SessionManager.create(cwd)` | 文件持久化 | JSONL 文件 |

**推荐方案**：使用 `SessionManager.create()` 持久化到 `~/.ai-sheet/sessions/`。

### 9.2 会话生命周期

```
App 启动 → Sidecar 启动 → SessionManager.load 或 新建 Session
     │
     ├── 用户对话 → Agent Loop → 工具调用 → 结果返回
     │
     ├── Tab 切换 → steer() 注入上下文
     │
     ├── Context 溢出 → Auto-Compaction 自动压缩
     │
     └── App 关闭 → Session 自动持久化
```

### 9.3 会话分支

pi-agent 的 JSONL 树状持久化天然支持分支：

- 用户可回溯到之前的消息点
- 从任意消息点创建分支继续对话
- 分支切换时自动生成摘要

这在 Excel 数据处理中很实用：
- 尝试不同公式方案时，可从同一需求点分支
- Python 代码修复时，可回溯到修复前的版本

---

## 十、各功能交互流程

### 10.1 公式生成

```
[右栏 Agent 对话]                        [中栏数据窗口]

用户: 统计每个区域销售总额
                                        ← (Agent 自动调用 read_excel)
Agent: 我看到你的数据有"销售额"和"区域"
       列，生成以下公式：

       =SUMIF(B:B, "华东", A:A)

       需要我应用到数据中吗？
                                        ← (Agent 调用 apply_formula)
用户: 数据在 Sheet2，而且我想要
      每个区域分开统计

Agent: 好的，针对 Sheet2 修改：
       =SUMIF(Sheet2!B:B, "华东", Sheet2!A:A)

       已应用到 Sheet2。                → [公式结果列显示]
```

### 10.2 Python 代码执行

```
[右栏 Agent 对话]

用户: 提取日期列的年月日

Agent: [生成代码]
       ```python
       import pandas as pd
       df = pd.read_excel('test.xlsx')
       df['日期'] = pd.to_datetime(df['日期'])
       df['年'] = df['日期'].dt.year
       df['月'] = df['日期'].dt.month
       df['日'] = df['日期'].dt.day
       df.to_excel('output.xlsx', index=False)
       ```
       [bash: python script.py] ← 工具调用卡片
       ✅ 执行成功，输出文件: output.xlsx

用户: 但日期格式是 2024年1月15日 这种

Agent: 明白，是中文日期格式。修改解析：
       ```python
       df['日期'] = pd.to_datetime(df['日期'], format='%Y年%m月%d日')
       ```
       [bash: python script.py] ← 工具调用卡片
       ✅ 执行成功

       还需要其他调整吗？
```

**与旧方案对比**：旧方案最多自动修复 3 次。pi-agent 可无限轮次，且用户可随时干预方向。

### 10.3 提示词生成

```
[右栏 Agent 对话]                        [中栏提示词预览]

用户: 写一个提取论文标题中人名的提示词

Agent: 几个关键问题：
       1. 输出格式？（JSON数组/逗号分隔/每行一人名）
       2. 中英文人名都要吗？
       3. 批量还是逐条处理？

用户: JSON数组，只要中文人名，批量处理

Agent: 提示词如下：                      → [实时更新预览]
       ---
       从以下论文标题中提取所有中国人名，
       返回 JSON 数组格式。

       规则：
       1. 通过 2-4 个汉字姓名特征判断
       2. 排除外国人名、机构名称
       3. 按原文顺序排列
       4. 仅返回 JSON 数组

       输入：{{input_text}}
       ---

       [save_prompt: "论文标题人名提取"]  ← 工具调用卡片
       ✅ 已保存到提示词库
```

---

## 十一、错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| LLM API 调用失败 | pi-agent 内置重试（指数退避），超出重试后 Agent 报告错误 |
| Python 代码执行失败 | Agent 自动查看错误，修改代码，重新执行（无限迭代） |
| 上下文溢出 | pi-agent Auto-Compaction 自动压缩，用户无感知 |
| Agent 长时间无响应 | 前端显示超时提示，提供"停止"按钮 |
| Excel 文件被占用 | Rust 返回错误，Agent 告知用户关闭文件后重试 |
| 批量处理中断 | 断点续传：BatchRunner 检查已处理行数，从中断点继续 |
| Tab 切换丢失对话 | 不会丢失：右栏对话是持久的，与 Tab 无关 |
| 多个工具并发调用 | pi-agent 工具支持 parallel/sequential 模式，按需配置 |

---

## 十二、开发路线

### 与主升级方案 Phase 的对应关系

| 主方案 Phase | 本文档对应工作 |
|-------------|-------------|
| Phase 0 | 安装 pi-agent SDK，搭建 `src-agent/` 项目结构 |
| Phase 1 | 实现 BridgeClient、Sidecar Manager、AgentSession 初始化、基础自定义工具、前端 AgentChatPanel |
| Phase 2 | 实现 Excel 工具（read_excel, write_excel, apply_formula），上下文注入联动 |
| Phase 3 | 系统提示词模板、公式生成对话流程、提示词生成对话流程、Python 代码执行流程、前端 ToolCallCard/CodeBlock |
| Phase 4 | BatchRunner 实现、批量处理工具、进度上报、前端 ProgressTracker |
| Phase 5 | SessionManager 持久化配置、会话历史管理 |
