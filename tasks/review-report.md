# AI-Sheet 升级方案完整评审报告

> 评审范围：技术架构决策、UI/UX设计、潜在风险识别、API配置方案
> 
> 评审时间：2026-06-05

---

## 执行摘要

### 总体评价

| 维度 | 评级 | 说明 |
|------|------|------|
| 架构决策 | ✅ 优秀 | 三进程架构设计合理，pi-agent集成减少12人天开发量 |
| UI/UX设计 | ⚠️ 需补充 | 缺少响应式适配、错误状态、加载状态的详细设计 |
| 技术风险 | ⚠️ 中等 | 跨进程通信、依赖稳定性、性能瓶颈需关注 |
| API配置方案 | ❌ 缺失 | 用户需求（默认配置+降级机制）未在当前方案中体现 |

### 关键发现

1. **API配置方案缺失** - 升级方案未包含用户要求的"默认API配置+失败降级"机制
2. **UI交互状态不完整** - 缺少加载态、错误态、空状态的组件设计
3. **跨进程通信风险** - HTTP Bridge和JSONL stdin/stdout通信缺少重试、超时、断线恢复机制
4. **小屏幕适配缺失** - 三栏布局在小屏幕（<1280px）下的体验未设计
5. **批量处理性能未验证** - 1000+行数据的批量LLM调用性能瓶颈未评估
6. **数据迁移风险** - 6个现有模型配置缺少`provider_type`字段，迁移脚本未设计

---

## 一、架构设计评审

### 1.1 三进程架构 ✅ 优秀

**设计决策：**
```
Rust (Tauri Core)     → Excel I/O, 配置管理, SQLite, 安全存储
Node.js (pi-agent)    → 所有LLM交互
React (WebView)       → 三栏UI
```

**优点：**
- ✅ 职责清晰：数据层(Rust) vs 智能层(Node.js) vs 界面层(React)
- ✅ pi-agent集成消除2735行自研代码（LLM客户端、Python执行器、对话管理）
- ✅ Rust保证Excel处理性能和安全性
- ✅ Node.js生态丰富，LLM工具链成熟

**潜在问题：**
- ⚠️ **进程间通信开销** - JSONL over stdin/stdout + HTTP Bridge双通道，延迟叠加
- ⚠️ **Sidecar启动时间** - Node.js冷启动可能需要1-3秒，影响首次使用体验
- ⚠️ **内存占用** - 三进程架构内存基线约150-200MB（Rust 30MB + Node 80MB + Chromium 100MB）

**建议：**
1. 实现Sidecar预热机制（App启动时后台启动Sidecar）
2. 添加进程健康检查（心跳机制）
3. 设计优雅降级：Sidecar挂掉时UI提示重启，不影响Excel查看功能

---

### 1.2 pi-agent集成 ✅ 优秀

**设计决策：** 用pi-agent SDK替代自研对话系统、LLM客户端、Python执行器

**优点：**
- ✅ 节省12人天开发工作量（多轮对话、流式输出、工具调用、上下文压缩）
- ✅ 内置SessionManager（JSONL持久化 + 分支导航）
- ✅ Agent Loop自动修复Python代码执行错误（无需手动重试限制）
- ✅ Auto-Compaction智能压缩上下文（用户无感知）

**潜在问题：**
- ⚠️ **API稳定性风险** - pi-agent是早期SDK，Breaking Changes风险高
- ⚠️ **调试困难** - Agent Loop黑盒化，工具调用失败难以追踪
- ⚠️ **依赖锁定** - 强依赖Anthropic生态，切换LLM Provider受限

**建议：**
1. 锁定pi-agent版本号（在package.json中精确版本，不用^或~）
2. 实现工具调用日志系统（记录每次工具调用的参数、结果、耗时）
3. 预留降级接口（如pi-agent不可用，回退到简单的OpenAI SDK调用）

---

### 1.3 跨进程通信设计 ⚠️ 需加固

**设计决策：**
- **Rust ↔ Node.js**: JSONL over stdin/stdout（用户消息、上下文注入、流式输出）
- **Node.js → Rust**: HTTP Bridge（工具调用Rust API）

**潜在问题：**
- ❌ **无超时机制** - JSONL通信未设计超时，Sidecar卡死会导致UI无响应
- ❌ **无重试机制** - HTTP Bridge调用失败无重试，网络抖动会导致工具调用失败
- ❌ **无断线恢复** - Sidecar意外退出后，需要重启整个App
- ❌ **无消息确认机制** - JSONL消息发送后无ACK，无法确认Sidecar是否收到

**建议（必须实现）：**
```rust
// Rust侧：Sidecar Manager
struct SidecarManager {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    health_check_interval: Duration,  // 心跳间隔（建议30秒）
    message_timeout: Duration,        // 消息超时（建议60秒）
}

impl SidecarManager {
    async fn send_message(&mut self, msg: Message) -> Result<()> {
        // 1. 发送前检查进程是否存活
        if !self.is_alive() { return Err("Sidecar已退出"); }
        
        // 2. 发送消息并启动超时计时器
        let timeout = tokio::time::timeout(
            self.message_timeout,
            self.write_jsonl(msg)
        ).await?;
        
        Ok(())
    }
    
    async fn restart_sidecar(&mut self) -> Result<()> {
        // 优雅关闭旧进程，启动新进程，恢复会话状态
    }
}
```

```typescript
// Node.js侧：HTTP Bridge Client
class BridgeClient {
    async post(endpoint: string, data: any, retries = 3): Promise<any> {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(`http://localhost:${this.port}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    signal: AbortSignal.timeout(30000),  // 30秒超时
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (e) {
                if (i === retries - 1) throw e;
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));  // 指数退避
            }
        }
    }
}
```

---

## 二、UI/UX设计评审

### 2.1 三栏布局 ⚠️ 需补充响应式设计

**当前设计：**
```
┌─────────────────────────────────────────────────────┐
│  [左栏:导航]  │  [中栏:数据]  │  [右栏:AI助手]  │
│   240px      │   flex-1      │    400px        │
└─────────────────────────────────────────────────────┘
```

**缺失设计：**
- ❌ **小屏幕适配（<1280px）** - 三栏并排在笔记本屏幕（1366×768）上拥挤
- ❌ **右栏折叠状态** - 无设计右栏折叠后的UI（只显示左栏+中栏）
- ❌ **最小窗口尺寸** - 未定义应用最小宽度/高度

**建议：**
```typescript
// 响应式断点设计
const BREAKPOINTS = {
  large: 1440,   // 三栏完整显示（240 + 800 + 400）
  medium: 1280,  // 右栏可折叠（240 + 800 + 240）
  small: 1024,   // 仅左栏+中栏，右栏浮层模式
  minimum: 960   // 应用最小宽度
};

// 右栏折叠交互
- 大屏（≥1440px）：右栏默认展开，宽400px
- 中屏（1280-1439px）：右栏默认折叠，宽60px（只显示图标），点击展开为400px浮层
- 小屏（1024-1279px）：右栏完全隐藏，通过右下角FAB按钮唤起全屏对话
```

---

### 2.2 双模式交互 ⚠️ 状态设计不完整

**当前设计：** 直接执行（表单/下拉框）+ Agent辅助（对话）

**缺失的交互状态设计：**

#### 加载状态缺失
- ❌ Excel文件上传时的进度条样式
- ❌ Agent思考时的动画（"正在分析数据..."）
- ❌ 批量处理时的进度显示（当前行/总行数、ETA、速度）
- ❌ 工具调用中的状态提示（"正在读取Excel..." → "读取完成✓"）

#### 错误状态缺失
- ❌ API调用失败的错误提示样式（重试按钮、错误详情折叠）
- ❌ Excel文件格式错误的提示（支持的格式、示例文件链接）
- ❌ Sidecar断开连接的全局提示（顶部Banner + 重连按钮）

#### 空状态缺失
- ❌ 未上传Excel时的中栏空状态（引导用户上传 + 示例截图）
- ❌ 对话历史为空时的右栏空状态（快速开始指南 + 常见问题）
- ❌ 提示词库为空时的管理页空状态（添加首个提示词引导）

**建议（必须补充）：**

创建 `DESIGN-STATES.md` 文档，包含：
1. **Loading Skeleton**: 每个组件的骨架屏设计（灰色占位符动画）
2. **Error Boundary**: 全局错误捕获组件的UI设计
3. **Empty States**: 每个功能页的空状态插图 + 文案
4. **Progress Indicators**: 长时间操作的进度反馈模式

---

## 三、关键缺失：API配置方案 ❌

### 3.1 用户需求分析

用户明确要求：
> 代码里有个默认的配置。当没有在界面中新增配置时就用默认的。如果页面中选择新增大模型api，则优先用这个，但支持失败时自动降级到默认的api配置

**核心需求拆解：**
1. **硬编码默认配置** - 代码内置1-2个免费/公共API配置
2. **优先级机制** - 用户配置 > 默认配置
3. **自动降级** - 用户API失败后，自动切换到默认API
4. **失败恢复** - 默认API也失败时的处理逻辑

### 3.2 当前方案的问题

**升级方案中未体现此需求：**
- ❌ `upgrade-plan-tauri-react.md` 未提及默认API配置
- ❌ `multi-turn-conversation-design.md` 未设计降级逻辑
- ❌ `PROJECT_GAP_ANALYSIS.md` 未列入迁移任务

**现有Python实现分析：**
```python
# config_manager.py 中的配置管理
class MultiModelConfigManager:
    def get_default_model(self):
        """获取默认模型配置"""
        models = self.config_data.get("models", [])
        default_index = self.config_data.get("settings", {}).get("default_model_index", 0)
        return models[default_index] if models else None
```

**问题：** 
- 现有实现依赖用户配置的models列表，无内置默认配置
- 没有失败降级逻辑


### 3.3 推荐设计方案

#### 方案A：内置默认配置 + 自动降级（推荐）

**架构设计：**

```rust
// src-tauri/src/config/defaults.rs

/// 内置默认API配置（硬编码在代码中）
pub const DEFAULT_MODELS: &[DefaultModelConfig] = &[
    DefaultModelConfig {
        name: "DeepSeek-V3 (Free)",
        provider_type: "openai-completions",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        api_key: "sk-free-trial-key",  // 公开的试用Key
        priority: 0,  // 最高优先级默认配置
        max_retries: 2,
    },
    DefaultModelConfig {
        name: "GLM-4-Flash (Free)",
        provider_type: "openai-completions",
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        model_id: "glm-4-flash",
        api_key: "free-trial-key",
        priority: 1,  // 次优先级默认配置
        max_retries: 2,
    },
];
```

```rust
// src-tauri/src/services/llm_service.rs

pub struct LLMService {
    user_models: Vec<ModelConfig>,      // 用户配置的模型
    default_models: Vec<DefaultModelConfig>,  // 内置默认模型
    current_model: ModelConfig,
    fallback_enabled: bool,
}

impl LLMService {
    /// 调用LLM，支持自动降级
    pub async fn call_with_fallback(
        &mut self,
        messages: Vec<Message>,
    ) -> Result<String> {
        // 1. 优先尝试用户配置的当前模型
        if let Some(user_model) = self.get_current_user_model() {
            match self.call_model(&user_model, &messages).await {
                Ok(response) => return Ok(response),
                Err(e) => {
                    warn!("用户模型调用失败: {}, 尝试降级到默认配置", e);
                    self.emit_event("llm-fallback", json!({
                        "from": user_model.name,
                        "reason": e.to_string(),
                    }));
                }
            }
        }

        // 2. 降级到默认配置（按优先级尝试）
        for default_model in &self.default_models {
            match self.call_model(&default_model.to_model_config(), &messages).await {
                Ok(response) => {
                    info!("降级成功，使用默认模型: {}", default_model.name);
                    return Ok(response);
                }
                Err(e) => {
                    warn!("默认模型 {} 调用失败: {}", default_model.name, e);
                }
            }
        }

        // 3. 所有模型都失败
        Err(anyhow!("所有API配置均失败，请检查网络连接或添加有效的API配置"))
    }

    /// 单次模型调用（带重试）
    async fn call_model(
        &self,
        model: &ModelConfig,
        messages: &[Message],
    ) -> Result<String> {
        let mut retries = 0;
        let max_retries = model.max_retries.unwrap_or(2);

        loop {
            match self.do_call(model, messages).await {
                Ok(response) => return Ok(response),
                Err(e) if retries < max_retries => {
                    retries += 1;
                    warn!("调用失败，第{}/{}次重试: {}", retries, max_retries, e);
                    tokio::time::sleep(Duration::from_millis(1000 * retries)).await;
                }
                Err(e) => return Err(e),
            }
        }
    }
}
```

**Node.js Sidecar 集成：**

```typescript
// src-agent/src/config/model-config.ts

import { Provider } from '@earendil-works/pi-ai';

export class ModelConfigService {
  private userModel: ModelConfig | null = null;
  private defaultModels: DefaultModelConfig[] = [
    {
      name: "DeepSeek-V3 (默认)",
      providerType: "anthropic-messages",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
      apiKey: "sk-free-trial-key",
      priority: 0,
    },
  ];

  async getModelProvider(): Promise<Provider> {
    // 1. 优先使用用户配置
    if (this.userModel) {
      try {
        return this.createProvider(this.userModel);
      } catch (e) {
        console.warn('用户模型配置无效，降级到默认配置:', e);
      }
    }

    // 2. 使用默认配置
    for (const defaultModel of this.defaultModels) {
      try {
        return this.createProvider(defaultModel);
      } catch (e) {
        console.warn(`默认模型 ${defaultModel.name} 配置失败:`, e);
      }
    }

    throw new Error('无可用的API配置');
  }

  private createProvider(config: ModelConfig | DefaultModelConfig): Provider {
    return {
      type: config.providerType,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.modelId,
    };
  }

  async loadUserModel(): Promise<void> {
    // 从Rust后端获取用户配置的当前模型
    const response = await fetch('http://localhost:${BRIDGE_PORT}/api/config/current');
    this.userModel = await response.json();
  }
}
```


### 3.3 推荐设计方案

#### 方案A：内置默认配置 + 自动降级（推荐）

**架构设计：**

```rust
// src-tauri/src/config/defaults.rs

pub const DEFAULT_MODELS: &[DefaultModelConfig] = &[
    DefaultModelConfig {
        name: "DeepSeek-V3 (Free)",
        provider_type: "openai-completions",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        api_key: "sk-free-trial",
        priority: 0,
    },
];
```

**降级逻辑：**
```rust
impl LLMService {
    pub async fn call_with_fallback(&mut self, messages: Vec<Message>) -> Result<String> {
        // 1. 尝试用户配置
        if let Some(user_model) = self.get_current_user_model() {
            if let Ok(response) = self.call_model(&user_model, &messages).await {
                return Ok(response);
            }
            warn!("用户模型失败，降级到默认配置");
        }

        // 2. 降级到默认配置
        for default in &self.default_models {
            if let Ok(response) = self.call_model(default, &messages).await {
                return Ok(response);
            }
        }

        Err(anyhow!("所有API配置均失败"))
    }
}
```

**UI提示设计：**
- 降级时显示Toast: "当前API不可用，已自动切换到默认配置"
- 设置页面显示默认配置标签（灰色Badge: "内置默认"）
- 首次启动引导："无需配置API Key即可试用，添加自己的API以解锁完整功能"

---

## 四、技术风险识别

### 4.1 性能风险

#### 批量处理性能瓶颈 ⚠️ 高风险

**问题：** 1000行数据批量LLM处理的性能未验证

**测算：**
```
假设：
- 单次LLM调用耗时：3秒（平均）
- 并发数：5（pi-ai默认限制）
- 1000行数据处理时间：1000 / 5 * 3 = 600秒 = 10分钟
```

**风险点：**
- ❌ 10分钟内用户无法关闭应用（强制等待）
- ❌ 网络抖动导致部分行失败，需要手动重跑
- ❌ 用户不清楚进度，可能误以为卡死

**建议（必须实现）：**
```typescript
// 批量处理优化
class BatchRunner {
  async run(params: BatchParams) {
    // 1. 支持暂停/继续
    this.pausable = true;

    // 2. 断点续传（失败行自动重试）
    const status = await this.getProcessingStatus();
    const startRow = status.lastProcessedRow + 1;

    // 3. 实时进度上报（每处理1行立即保存+通知前端）
    for (let i = startRow; i < rows.length; i++) {
      await this.processRow(i);
      await this.saveProgress(i);  // 每行立即保存
      this.emitProgress({ current: i, total: rows.length });
    }

    // 4. 失败重试策略
    for (const failedRow of this.failedRows) {
      await this.retryRow(failedRow, maxRetries: 3);
    }
  }
}
```


#### Excel大文件处理性能 ⚠️ 中风险

**问题：** Rust Excel库（calamine + rust_xlsxwriter）性能未测试

**现有Python实现：**
- openpyxl：纯Python实现，5000行读取耗时约2-5秒
- 支持最大5000行（配置文件限制）

**Rust实现预期：**
- calamine：纯Rust实现，理论上比openpyxl快5-10倍
- rust_xlsxwriter：写入性能优秀

**风险：**
- ❌ calamine对复杂Excel格式（合并单元格、公式、样式）的兼容性未验证
- ❌ 大文件（>50MB）的内存占用未测试

**建议：**
1. Phase 0创建性能基准测试（读取/写入1000行、5000行、10000行）
2. 设置内存限制警告（超过100MB提示用户）
3. 对超大文件（>10000行）提供分批处理选项

---

### 4.2 依赖风险

#### pi-agent SDK稳定性 ⚠️ 高风险

**问题：** pi-agent是2024年发布的早期SDK，API可能不稳定

**风险矩阵：**
| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| Breaking Changes | 中 | 高 | 锁定版本号，延迟升级 |
| Bug导致Agent卡死 | 中 | 高 | 实现超时机制+重启Sidecar |
| 上下文压缩失败 | 低 | 中 | 监控压缩事件，压缩失败时清空对话 |
| 工具调用参数验证失败 | 中 | 中 | 在工具execute中额外验证参数 |

**建议（必须实现）：**
```json
// package.json - 锁定精确版本
{
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.1.5",  // 不使用 ^0.1.5
    "@earendil-works/pi-ai": "0.2.3"
  }
}
```

```typescript
// Sidecar健康检查
class SidecarMonitor {
  private lastHeartbeat: number = Date.now();
  
  startMonitoring() {
    setInterval(() => {
      if (Date.now() - this.lastHeartbeat > 60000) {
        console.error('Sidecar心跳超时，触发重启');
        this.restartSidecar();
      }
    }, 30000);
  }
  
  heartbeat() {
    this.lastHeartbeat = Date.now();
    writeOutput({ type: 'heartbeat' });
  }
}
```

---

### 4.3 数据一致性风险

#### 跨进程数据同步 ⚠️ 中风险

**问题：** Agent通过工具修改Excel后，前端中栏需要立即刷新

**当前设计：**
```typescript
listen('agent-tool-end', (event) => {
  if (['write_excel', 'apply_formula'].includes(event.tool)) {
    useExcelStore.getState().refresh();  // 重新读取Excel
  }
});
```

**风险点：**
- ❌ Agent写入与用户手动编辑冲突（同时修改同一单元格）
- ❌ 刷新时机延迟（工具调用完成 → 事件传递 → 前端刷新）
- ❌ 大文件刷新卡顿（每次工具调用都重新读取整个文件）

**建议：**
```rust
// 增量更新机制
#[tauri::command]
async fn write_excel_incremental(
    path: String,
    updates: Vec<CellUpdate>,
) -> Result<IncrementalUpdateEvent> {
    // 1. 写入Excel
    excel_service.write_cells(&path, &updates)?;
    
    // 2. 返回增量更新数据（而非让前端重新读取整个文件）
    Ok(IncrementalUpdateEvent {
        path,
        updates,  // 前端直接更新这些单元格，无需重新读取文件
    })
}
```

```typescript
// 前端增量更新
listen('excel-incremental-update', (event) => {
  const { path, updates } = event.payload;
  useExcelStore.getState().applyIncrementalUpdates(path, updates);
});
```


---

## 五、数据迁移方案补充

### 5.1 现有配置迁移 ❌ 缺失

**问题：** 现有6个模型配置缺少`provider_type`字段

**现有数据：**
```json
{
  "name": "DeepSeek-V3.1",
  "api_key": "xxx",
  "base_url": "https://api.sambanova.ai/v1",
  "model_id": "DeepSeek-V3.1"
}
```

**新数据结构需要：**
```json
{
  "name": "DeepSeek-V3.1",
  "api_key": "xxx",
  "base_url": "https://api.sambanova.ai/v1",
  "model_id": "DeepSeek-V3.1",
  "provider_type": "openai-completions"  // 新增字段
}
```

**自动推断规则：**
```rust
fn infer_provider_type(base_url: &str, model_id: &str) -> &'static str {
    if base_url.contains("openai.com") {
        "openai-completions"
    } else if base_url.contains("anthropic.com") {
        "anthropic-messages"
    } else if base_url.contains("deepseek.com") 
        || base_url.contains("sambanova.ai")
        || base_url.contains("cerebras.ai")
        || base_url.contains("groq.com") {
        "openai-completions"  // OpenAI兼容API
    } else if base_url.contains("bigmodel.cn") {
        "openai-completions"  // GLM使用OpenAI格式
    } else {
        "openai-completions"  // 默认假设OpenAI兼容
    }
}
```

**迁移脚本：**
```rust
// tools/migrate_config.rs

async fn migrate_models_config() -> Result<()> {
    // 1. 读取旧配置
    let old_config = fs::read_to_string("config/models_config.json")?;
    let mut config: Value = serde_json::from_str(&old_config)?;
    
    // 2. 为每个模型补充provider_type
    if let Some(models) = config["models"].as_array_mut() {
        for model in models {
            if model.get("provider_type").is_none() {
                let base_url = model["base_url"].as_str().unwrap_or("");
                let model_id = model["model_id"].as_str().unwrap_or("");
                let provider_type = infer_provider_type(base_url, model_id);
                model["provider_type"] = json!(provider_type);
            }
        }
    }
    
    // 3. 保存到SQLite
    let db = Database::open("data/config.db")?;
    for model in config["models"].as_array().unwrap() {
        db.execute(
            "INSERT INTO models (name, api_key, base_url, model_id, provider_type) VALUES (?, ?, ?, ?, ?)",
            params![
                model["name"],
                model["api_key"],
                model["base_url"],
                model["model_id"],
                model["provider_type"],
            ]
        )?;
    }
    
    // 4. 加密API Key迁移到tauri-plugin-store
    for model in config["models"].as_array().unwrap() {
        store.set(
            format!("api_key_{}", model["name"]),
            model["api_key"].as_str().unwrap()
        )?;
    }
    
    Ok(())
}
```

---

## 六、改进建议汇总

### 6.1 必须实现（P0）

| 编号 | 类别 | 问题 | 建议 |
|------|------|------|------|
| P0-1 | API配置 | 缺少默认配置+降级机制 | 实现内置默认配置 + 自动降级逻辑 |
| P0-2 | 通信 | 跨进程通信无超时/重试 | 添加超时机制、指数退避重试、心跳检查 |
| P0-3 | UI状态 | 缺少加载/错误/空状态设计 | 创建DESIGN-STATES.md补充设计 |
| P0-4 | 数据迁移 | 模型配置缺少provider_type | 编写迁移脚本自动推断provider_type |
| P0-5 | 批量处理 | 无暂停/断点续传 | 实现暂停机制 + 每行立即保存 |

### 6.2 强烈建议（P1）

| 编号 | 类别 | 问题 | 建议 |
|------|------|------|------|
| P1-1 | 响应式 | 三栏布局无小屏适配 | 添加响应式断点 + 右栏折叠 |
| P1-2 | 性能 | 批量处理性能未测试 | Phase 0创建性能基准测试 |
| P1-3 | 依赖 | pi-agent版本不稳定 | 锁定精确版本 + Sidecar健康检查 |
| P1-4 | 数据同步 | Excel刷新全量读取 | 实现增量更新机制 |
| P1-5 | 错误处理 | Sidecar断开无恢复 | 实现优雅降级 + 自动重启 |

### 6.3 可选优化（P2）

| 编号 | 类别 | 建议 |
|------|------|------|
| P2-1 | 启动速度 | Sidecar预热机制（App启动时后台启动） |
| P2-2 | 内存优化 | 大文件分批加载（虚拟滚动） |
| P2-3 | 用户体验 | 首次启动引导流程（产品Tour） |
| P2-4 | 可观测性 | 工具调用日志系统（调试模式） |

---

## 七、修订后的开发计划

### 原计划 vs 修订后

| Phase | 原计划人天 | 新增任务 | 修订后人天 |
|-------|-----------|---------|-----------|
| Phase 0 | 4.5 | + 性能基准测试 | **5.5** |
| Phase 1 | 11 | + 跨进程通信加固 + 默认API配置 | **14** |
| Phase 2 | 10 | + 数据迁移脚本 + 增量更新 | **12** |
| Phase 3 | 10 | + UI状态设计补充 | **11** |
| Phase 4 | 6 | + 批量处理优化 | **8** |
| Phase 5 | 6 | + Sidecar健康检查 | **7** |
| **总计** | **47.5** | | **57.5** |

**关键路径变化：**
- Phase 1增加3天（通信加固 + API配置）
- Phase 2增加2天（迁移脚本 + 增量更新）
- Phase 4增加2天（批量处理暂停/续传）

---

## 八、风险矩阵

| 风险 | 可能性 | 影响 | 严重度 | 缓解措施 | 责任人 |
|------|--------|------|--------|---------|--------|
| API配置方案缺失 | 高 | 高 | **严重** | 立即补充设计 | 架构师 |
| 跨进程通信不稳定 | 中 | 高 | **严重** | 加固通信机制 | 后端开发 |
| pi-agent版本不稳定 | 中 | 高 | **严重** | 锁定版本+降级方案 | 全栈开发 |
| 批量处理性能差 | 中 | 中 | **中等** | 性能测试+优化 | 后端开发 |
| UI状态设计不完整 | 低 | 中 | **中等** | 补充设计文档 | UI设计师 |
| 数据迁移失败 | 低 | 高 | **中等** | 自动化测试 | 后端开发 |


---

## 九、行动计划

### 立即行动（本周完成）

1. **补充API配置设计** ✅
   - 在upgrade-plan中新增"API配置与降级机制"章节
   - 设计内置默认配置的API选择（DeepSeek/GLM免费额度）
   - 实现降级逻辑伪代码

2. **补充UI状态设计** ✅
   - 创建DESIGN-STATES.md文档
   - 设计每个功能页的加载/错误/空状态
   - 设计响应式断点规则

3. **加固跨进程通信** ✅
   - 在multi-turn-conversation-design.md中补充超时/重试机制
   - 设计Sidecar健康检查协议
   - 设计断线恢复流程

### 开发前准备（Phase 0前）

4. **编写数据迁移脚本**
   - 实现provider_type自动推断
   - 实现API Key加密迁移
   - 编写迁移测试用例

5. **创建性能基准测试**
   - Excel读写性能测试（1K/5K/10K行）
   - 批量LLM调用性能测试（并发度1/5/10）
   - 内存占用监控

### 开发中验证（每个Phase结束）

6. **Phase 1验证**
   - 跨进程通信稳定性测试（模拟网络延迟、Sidecar崩溃）
   - 默认API配置有效性测试
   - HTTP Bridge性能测试

7. **Phase 2验证**
   - Excel增量更新正确性测试
   - 数据迁移完整性测试
   - 大文件（10K+行）性能测试

8. **Phase 4验证**
   - 批量处理暂停/续传测试
   - 1000行批量处理端到端测试
   - 失败重试机制测试

---

## 十、结论

### 整体评价

**升级方案基础扎实**，三进程架构设计合理，pi-agent集成大幅减少开发量。但在以下关键领域存在**严重缺失**：

1. **API配置方案缺失** - 用户核心需求未体现
2. **跨进程通信脆弱** - 缺少容错机制
3. **UI交互状态不完整** - 影响用户体验

### 关键数字

- **新增工作量**: +10人天（47.5 → 57.5）
- **严重风险**: 3个（API配置、通信稳定性、依赖稳定性）
- **必须修复问题**: 5个（P0级别）

### 建议

**不建议直接开始Phase 0**，建议先完成以下工作：

1. ✅ 补充API配置设计（1天）
2. ✅ 补充UI状态设计（1天）
3. ✅ 加固跨进程通信设计（1天）
4. ✅ 编写数据迁移脚本（2天）

**修订后可以开始实施**，预期工期57.5人天。

---

## 附录A：默认API配置推荐

### 推荐的免费API配置

| 提供商 | 模型 | 免费额度 | API格式 | 推荐度 |
|--------|------|---------|---------|--------|
| DeepSeek | deepseek-chat | 无限制（有速率限制） | OpenAI兼容 | ⭐⭐⭐⭐⭐ |
| 智谱AI | glm-4-flash | 免费试用 | OpenAI兼容 | ⭐⭐⭐⭐ |
| Groq | llama-3.1-70b | 每日限额 | OpenAI兼容 | ⭐⭐⭐ |

**建议默认配置：**
```rust
pub const DEFAULT_MODELS: &[DefaultModelConfig] = &[
    DefaultModelConfig {
        name: "DeepSeek-V3 (内置默认)",
        provider_type: "openai-completions",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        api_key: "",  // DeepSeek支持无Key试用
        priority: 0,
    },
];
```

---

## 附录B：响应式设计规范

### 三栏布局响应式断点

```typescript
// 断点定义
const BREAKPOINTS = {
  xlarge: 1600,  // 超大屏：左240 + 中960 + 右400
  large: 1440,   // 大屏：左240 + 中800 + 右400
  medium: 1280,  // 中屏：左240 + 中800 + 右240（折叠）
  small: 1024,   // 小屏：左240 + 中784，右栏浮层
  minimum: 960,  // 最小宽度
};

// 布局规则
useEffect(() => {
  const width = window.innerWidth;
  
  if (width >= BREAKPOINTS.large) {
    setLayout({ left: 240, center: 'flex-1', right: 400, rightMode: 'fixed' });
  } else if (width >= BREAKPOINTS.medium) {
    setLayout({ left: 240, center: 'flex-1', right: 60, rightMode: 'collapsed' });
  } else if (width >= BREAKPOINTS.small) {
    setLayout({ left: 240, center: 'flex-1', right: 0, rightMode: 'overlay' });
  } else {
    // 低于最小宽度，显示警告
    showMinimumWidthWarning();
  }
}, [window.innerWidth]);
```

---

**文档版本**: v1.0  
**评审日期**: 2026-06-05  
**评审人**: AI-Sheet 技术评审团队  
**状态**: 待确认

