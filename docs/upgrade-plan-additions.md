# AI-Sheet 升级方案补充章节

> 根据技术审查报告完善的关键设计章节

---

## 九、API 配置方案设计（P0-1 修复）

### 9.1 需求背景

用户明确要求：
> "代码里有个默认的配置。当没有在界面中新增配置时就用默认的。如果页面中选择新增大模型api，则优先用这个，但支持失败时自动降级到默认的api配置"

### 9.2 默认模型选择

**内置免费 API（硬编码在 Rust 中）**：

| 模型 | Provider | 理由 |
|------|----------|------|
| DeepSeek-V3 | `deepseek-chat` | 免费额度大，性能优秀，国内访问快 |
| GLM-4-Flash | `glm-4-flash` | 智谱免费额度充足，备用选择 |

**硬编码配置**：

```rust
// src-tauri/src/services/config_service.rs
pub const DEFAULT_MODELS: &[DefaultModel] = &[
    DefaultModel {
        name: "DeepSeek-V3 (默认免费)",
        api_key: "", // 无需密钥或使用公共密钥
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        provider_type: "openai-completions",
    },
    DefaultModel {
        name: "GLM-4-Flash (备用免费)",
        api_key: "", // 无需密钥或使用公共密钥
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        model_id: "glm-4-flash",
        provider_type: "openai-completions",
    },
];

impl ConfigService {
    /// 获取可用模型（优先级：用户配置 → 默认配置）
    pub async fn get_active_model(&self) -> Result<ModelConfig, AppError> {
        // 1. 尝试获取用户设置的默认模型
        if let Some(user_model) = self.get_default_user_model().await? {
            return Ok(user_model);
        }
        
        // 2. 降级到硬编码的默认模型
        Ok(self.get_fallback_model())
    }
    
    /// 获取降级模型（硬编码）
    fn get_fallback_model(&self) -> ModelConfig {
        DEFAULT_MODELS[0].to_model_config()
    }
}
```

### 9.3 自动降级机制

**降级流程**（在 Node.js Sidecar 中实现）：

```typescript
// src-agent/services/model-fallback.ts
export class ModelFallbackService {
  private failureCount = new Map<string, number>();
  
  async callWithFallback(
    userModel: ModelConfig | null,
    prompt: string,
    options: CallOptions
  ): Promise<string> {
    const models = this.buildModelChain(userModel);
    
    for (const [index, model] of models.entries()) {
      try {
        const result = await this.callModel(model, prompt, options);
        
        // 成功则重置失败计数
        this.failureCount.set(model.name, 0);
        
        // 如果使用了降级模型，发送通知
        if (index > 0) {
          await bridge.post('/api/events/notify', {
            type: 'model_fallback',
            message: `主模型失败，已自动切换到：${model.name}`,
            level: 'warning'
          });
        }
        
        return result;
      } catch (error) {
        const count = (this.failureCount.get(model.name) || 0) + 1;
        this.failureCount.set(model.name, count);
        
        console.error(`模型 ${model.name} 调用失败 (第${count}次):`, error);
        
        // 如果是最后一个模型，抛出错误
        if (index === models.length - 1) {
          throw new Error(`所有模型均调用失败，包括默认降级模型`);
        }
        
        // 继续尝试下一个模型
      }
    }
  }
  
  private buildModelChain(userModel: ModelConfig | null): ModelConfig[] {
    const chain: ModelConfig[] = [];
    
    // 1. 用户配置的模型（如果存在）
    if (userModel) {
      chain.push(userModel);
    }
    
    // 2. 硬编码的默认模型
    chain.push(...DEFAULT_MODELS);
    
    return chain;
  }
}
```

### 9.4 UI 通知设计

降级发生时，在右栏 Agent 面板顶部显示 Toast：

```tsx
// components/agent/FallbackNotice.tsx
<Toast variant="warning">
  <AlertTriangle className="w-4 h-4" />
  <span>主模型 {userModel.name} 调用失败，已自动切换到默认模型 DeepSeek-V3</span>
  <Button size="sm" onClick={() => navigate('/admin/config')}>
    检查配置
  </Button>
</Toast>
```

### 9.5 配置优先级逻辑

```
┌─────────────────────────────────────────┐
│         LLM 调用请求                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  是否有用户配置的默认模型？               │
└──┬──────────────────────────────────┬───┘
   │ 是                                │ 否
   ▼                                  ▼
┌─────────────────┐         ┌──────────────────┐
│ 使用用户模型     │         │ 使用 DeepSeek-V3  │
└────┬────────────┘         └────┬─────────────┘
     │                           │
     ▼                           │
┌─────────────────┐              │
│  调用成功？      │              │
└─┬───────────┬───┘              │
  │ 是        │ 否                │
  ▼           ▼                  │
成功      ┌────────────┐          │
          │ 降级到默认  │◄─────────┘
          │ DeepSeek-V3│
          └─────┬──────┘
                ▼
          ┌────────────┐
          │ 调用成功？  │
          └─┬──────┬───┘
            │ 是   │ 否
            ▼      ▼
          成功   尝试 GLM-4-Flash
          (显示   (第二降级)
          警告)        │
                      ▼
                 ┌────────────┐
                 │ 调用成功？  │
                 └─┬──────┬───┘
                   │ 是   │ 否
                   ▼      ▼
                 成功   所有模型
                 (警告) 均失败
                         ▼
                    显示错误对话框
```

---

## 十、跨进程通信加固设计（P0-2 修复）

### 10.1 当前风险分析

**现有设计缺陷**：
- ❌ Sidecar 挂起 → 主进程无限等待
- ❌ HTTP Bridge 请求无超时
- ❌ stdin/stdout 无心跳检测
- ❌ 无重连机制

### 10.2 超时机制

#### 10.2.1 Rust → Sidecar（stdin 命令）

```rust
// src-tauri/src/services/sidecar_manager.rs
pub async fn send_with_timeout(
    &self,
    message: &str,
    timeout: Duration,
) -> Result<(), AppError> {
    tokio::time::timeout(timeout, self.send_message(message))
        .await
        .map_err(|_| AppError::SidecarTimeout)?
        .map_err(|e| AppError::SidecarError(e.to_string()))
}

// 使用示例
manager.send_with_timeout(
    r#"{"type":"user_message","content":"..."}"#,
    Duration::from_secs(30) // 30秒超时
).await?;
```

#### 10.2.2 Sidecar → Rust（HTTP Bridge）

```typescript
// src-agent/bridge.ts
export class BridgeClient {
  private readonly defaultTimeout = 30000; // 30秒
  
  async post<T>(
    endpoint: string,
    data: unknown,
    timeout = this.defaultTimeout
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`请求超时 (${timeout}ms): ${endpoint}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

### 10.3 心跳检测

```rust
// src-tauri/src/services/sidecar_manager.rs
pub struct SidecarManager {
    // ... 现有字段
    last_heartbeat: Arc<RwLock<Instant>>,
    heartbeat_task: Option<JoinHandle<()>>,
}

impl SidecarManager {
    /// 启动心跳监控任务
    pub async fn start_heartbeat_monitor(&mut self, app: AppHandle) {
        let last_heartbeat = self.last_heartbeat.clone();
        
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            
            loop {
                interval.tick().await;
                
                let elapsed = last_heartbeat.read().await.elapsed();
                
                if elapsed > Duration::from_secs(15) {
                    // 15秒无心跳，判定为死亡
                    app.emit_all("sidecar-dead", json!({
                        "message": "Sidecar 进程失去响应",
                        "elapsed_secs": elapsed.as_secs()
                    })).ok();
                    
                    // 尝试重启
                    // （在实际实现中调用 restart 方法）
                    break;
                }
            }
        });
        
        self.heartbeat_task = Some(task);
    }
    
    /// 更新心跳时间（每次收到 stdout 事件时调用）
    pub async fn record_heartbeat(&self) {
        *self.last_heartbeat.write().await = Instant::now();
    }
}
```

### 10.4 重连机制

```rust
// src-tauri/src/services/sidecar_manager.rs
impl SidecarManager {
    /// 自动重启 Sidecar
    pub async fn restart(&mut self, app: AppHandle) -> Result<(), AppError> {
        log::warn!("正在重启 Sidecar...");
        
        // 1. 停止旧进程
        self.stop().await.ok();
        
        // 2. 清理状态
        self.process = None;
        
        // 3. 等待端口释放
        tokio::time::sleep(Duration::from_secs(1)).await;
        
        // 4. 重新启动
        self.start(app.clone()).await?;
        
        // 5. 发送通知
        app.emit_all("sidecar-restarted", json!({
            "message": "AI Agent 已重新连接",
            "timestamp": chrono::Utc::now().to_rfc3339()
        })).ok();
        
        Ok(())
    }
}
```

### 10.5 错误恢复策略

```typescript
// src-agent/main.ts
class ErrorRecovery {
  private retryCount = 0;
  private maxRetries = 3;
  
  async handleError(error: Error, context: string) {
    console.error(`[${context}] 错误:`, error);
    
    this.retryCount++;
    
    if (this.retryCount <= this.maxRetries) {
      // 指数退避重试
      const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 10000);
      console.log(`${delay}ms 后重试 (${this.retryCount}/${this.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return 'retry';
    } else {
      // 超过重试次数，输出错误到 stdout
      console.log(JSON.stringify({
        type: 'agent_error',
        error: error.message,
        context,
        fatal: true
      }));
      return 'fatal';
    }
  }
  
  reset() {
    this.retryCount = 0;
  }
}
```

### 10.6 前端错误处理

```tsx
// hooks/useAgentRecovery.ts
export function useAgentRecovery() {
  const { error, setError } = useAgentStore();
  const [isRecovering, setIsRecovering] = useState(false);
  
  useEffect(() => {
    const unlisten = listen('sidecar-dead', async () => {
      setIsRecovering(true);
      
      try {
        // 调用 Rust 重启命令
        await invoke('restart_sidecar');
        setError(null);
      } catch (e) {
        setError('AI Agent 无法恢复，请重启应用');
      } finally {
        setIsRecovering(false);
      }
    });
    
    return () => { unlisten.then(f => f()); };
  }, []);
  
  return { isRecovering };
}
```

---

## 十一、UI 状态设计规范（P0-3 修复）

### 11.1 加载状态设计

#### 11.1.1 骨架屏组件

```tsx
// components/ui/Skeleton.tsx
export const TableSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex gap-4">
        <Skeleton className="h-10 w-12" />
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-24" />
      </div>
    ))}
  </div>
);

export const AgentMessageSkeleton = () => (
  <div className="flex gap-3">
    <Skeleton className="h-8 w-8 rounded-full" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  </div>
);
```

#### 11.1.2 进度指示器

```tsx
// components/ui/ProgressIndicator.tsx
export const BatchProgress = ({ current, total, speed }: ProgressProps) => {
  const percentage = (current / total) * 100;
  const remaining = Math.ceil((total - current) / speed);
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{current} / {total} 行</span>
        <span>{percentage.toFixed(1)}%</span>
      </div>
      
      <Progress value={percentage} className="h-2" />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>速度: {speed.toFixed(1)} 行/分钟</span>
        <span>预计剩余: {remaining} 分钟</span>
      </div>
    </div>
  );
};
```

### 11.2 错误状态设计

#### 11.2.1 错误边界

```tsx
// components/ErrorBoundary.tsx
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <ErrorFallback
          error={this.state.error!}
          reset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    
    return this.props.children;
  }
}
```


#### 11.2.2 API 错误提示

```tsx
// components/ErrorAlert.tsx
export const ApiErrorAlert = ({ error, onRetry }: ErrorAlertProps) => {
  const errorMessages: Record<string, string> = {
    'NETWORK_ERROR': '网络连接失败，请检查网络设置',
    'API_KEY_INVALID': 'API Key 无效，请检查配置',
    'RATE_LIMIT': 'API 调用频率超限，请稍后重试',
    'TIMEOUT': '请求超时，请重试',
  };
  
  const message = errorMessages[error.code] || error.message;
  
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>调用失败</AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>{message}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" />
            重试
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};
```

### 11.3 空状态设计

#### 11.3.1 数据为空

```tsx
// components/EmptyState.tsx
export const EmptyExcelState = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <FileSpreadsheet className="w-16 h-16 text-muted-foreground mb-4" />
    <h3 className="text-lg font-semibold mb-2">还没有数据</h3>
    <p className="text-sm text-muted-foreground mb-6 max-w-sm">
      请先上传 Excel 文件，或从左侧导航进入"Excel 上传"页面
    </p>
    <Button onClick={() => navigate('/data/upload')}>
      <Upload className="w-4 h-4 mr-2" />
      上传 Excel
    </Button>
  </div>
);
```

### 11.4 响应式设计

#### 11.4.1 断点定义

```typescript
// styles/breakpoints.ts
export const breakpoints = {
  sm: 640,   // 小屏手机
  md: 768,   // 平板
  lg: 1024,  // 小屏笔记本
  xl: 1280,  // 标准屏幕（三栏布局最小宽度）
  '2xl': 1536, // 大屏
};

export const MIN_THREE_COLUMN_WIDTH = 1280; // 三栏布局最小宽度
```

---

## 十二、数据迁移方案（P0-4 修复）

### 12.1 迁移需求

**现有数据**（`model_config.json`）缺失 `provider_type` 字段（pi-agent 必需）

### 12.2 自动推断规则

```rust
// src-tauri/src/migration/provider_inference.rs
pub fn infer_provider_type(base_url: &str, model_id: &str) -> String {
    // 基于 base_url 域名推断
    if base_url.contains("api.openai.com") {
        return "openai-chat".to_string();
    }
    if base_url.contains("api.anthropic.com") {
        return "anthropic-messages".to_string();
    }
    if base_url.contains("api.deepseek.com") {
        return "openai-completions".to_string();
    }
    
    // 默认降级（OpenAI 兼容最广泛）
    "openai-completions".to_string()
}
```

---

## 十三、批量处理增强设计（P0-5 修复）

### 13.1 暂停/恢复机制

```typescript
// src-agent/batch/runner.ts
export class BatchRunner {
  private pauseSignal: { paused: boolean } = { paused: false };
  
  async run(params: BatchParams, onProgress: ProgressCallback) {
    for (let i = 0; i < data.rows.length; i++) {
      // 检查暂停信号
      while (this.pauseSignal.paused && !this.abortController.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 处理行...
    }
  }
  
  pause() { this.pauseSignal.paused = true; }
  resume() { this.pauseSignal.paused = false; }
}
```

### 13.2 断点续传

```typescript
class CheckpointManager {
  async save(batchId: string, index: number) {
    await fs.writeFile(
      `${this.checkpointPath}/${batchId}.json`,
      JSON.stringify({ batchId, lastIndex: index, timestamp: new Date().toISOString() })
    );
  }
  
  async load(batchId: string): Promise<BatchCheckpoint | null> {
    try {
      const content = await fs.readFile(`${this.checkpointPath}/${batchId}.json`, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
```

---

## 十四、修订后的开发计划

### 14.1 总工时修正

| Phase | 原计划 | 修正后 | 增量 |
|-------|--------|--------|------|
| Phase 0 | 4.5d | 5.5d | +1d |
| Phase 1 | 11d | 14d | +3d |
| Phase 2 | 11.5d | 11.5d | - |
| Phase 3 | 10d | 11d | +1d |
| Phase 4 | 10d | 12d | +2d |
| Phase 5 | 6d | 8d | +2d |
| **总计** | **53d** | **62d** | **+9d** |

**单人预计**：12-14周（原 10-12周）  
**双人预计**：8-9周（原 7-8周）

---

## 十五、验证清单补充

| 编号 | 验证项 | 验收标准 |
|------|--------|---------|
| V-1 | API 配置降级 | 删除所有用户配置 → 应用仍可调用 DeepSeek-V3 |
| V-2 | Sidecar 重启 | 手动杀死 Node.js 进程 → 15秒内自动重启 |
| V-3 | 响应式布局 | 窗口缩小到1024px → 右栏自动折叠 |
| V-4 | 数据迁移 | 放置旧版配置 → 自动迁移并加密 API Key |
| V-5 | 批量暂停续传 | 暂停后关闭应用 → 重启后从断点继续 |

---

**文档版本**：v2.1  
**更新日期**：2026-06-05  
**审查依据**：[技术审查报告](../tasks/review-report.md)
