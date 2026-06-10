# Plan: Pi Agent 动态工作目录 + Skill 持久化

## Context

当前 pi agent 的 `cwd` 固定为 `process.cwd()`（项目代码路径），导致内置工具（bash/read/write/edit）的相对路径解析都基于代码目录，而非用户数据所在位置。需要：
1. 默认 cwd 改为 DB 数据库文件所在目录（Tauri app data dir）
2. 加载 Excel 后，cwd 自动切换到 Excel 文件所在目录（多个 Excel 取第一个）
3. Python 处理 skill 在 cwd 变化后仍可被 pi agent 识别调用

## 方案设计

### 核心思路

pi agent SDK **没有**运行时动态更新 `cwd` 的 API。`cwd` 在 `createAgentSession()` 时确定，影响内置工具的路径解析。因此采用 **两层策略**：

- **实际 cwd**：用 `DefaultResourceLoader` + `skillsOverride` 确保项目 skill 始终注入，与 cwd 解耦
- **逻辑 cwd**：通过 `steer()` 告知 agent 当前工作目录，让 agent 在使用 bash/read/write 时使用绝对路径或 `cd` 到正确目录

### 为什么不重建 session

重建 session（`createAgentSessionRuntime`）会丢失对话历史、需要重新订阅事件、重新绑定扩展，代价过大。用 steer 通知 + 技能注入是更轻量的方案。

---

## 实现步骤

### Step 1: 新增 `set_cwd` 协议命令

**文件**: `src-agent/src/protocol.ts`

在 `SidecarCommand` 联合类型中新增：
```typescript
| { id: string; type: 'set_cwd'; cwd: string }
```

在 `SidecarEvent` 中新增：
```typescript
| { type: 'cwd_changed'; id: string; cwd: string }
```

---

### Step 2: 在 AgentContext 中加入 cwd 字段

**文件**: `src-agent/src/protocol.ts`

在 `AgentContext` 接口中新增：
```typescript
cwd?: string;
```

---

### Step 3: 修改 agent 创建逻辑，使用 ResourceLoader 注入 skill

**文件**: `src-agent/src/agent.ts`

将 `cwd` 默认值改为 DB 路径（通过 `--db-dir` 参数传入），并用 `DefaultResourceLoader` + `skillsOverride` 确保 `python-processing` skill 始终可用：

```typescript
import { createAgentSession, DefaultResourceLoader, type Skill } from '@earendil-works/pi-coding-agent';

// 解析项目根目录下的 .pi/skills/python-processing/SKILL.md 路径
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pythonSkill: Skill = {
  name: 'python-processing',
  description: 'Python 数据处理工作流...',
  filePath: join(projectRoot, '.pi', 'skills', 'python-processing', 'SKILL.md'),
  baseDir: join(projectRoot, '.pi', 'skills', 'python-processing'),
  source: 'custom',
};

const loader = new DefaultResourceLoader({
  cwd: initialCwd,  // DB 数据目录或 Excel 所在目录
  agentDir: getAgentDir(),
  skillsOverride: (current) => ({
    skills: [...current.skills, pythonSkill],
    diagnostics: current.diagnostics,
  }),
});
await loader.reload();

const { session } = await createAgentSession({
  model,
  tools: ['read', 'bash', 'edit', 'write'],
  customTools,
  authStorage,
  modelRegistry,
  settingsManager,
  sessionManager: SessionManager.inMemory(),
  cwd: initialCwd,
  resourceLoader: loader,
});
```

这样无论 cwd 如何变化，`python-processing` skill 都通过 `skillsOverride` 注入，不依赖 cwd 目录扫描。

---

### Step 4: 处理 set_cwd 命令 — steer 通知 + 逻辑 cwd 追踪

**文件**: `src-agent/src/main.ts`

新增 `handleSetCwd` 处理函数：

```typescript
let currentCwd: string = initialCwd;

async function handleSetCwd(command: { id: string; type: 'set_cwd'; cwd: string }) {
  currentCwd = command.cwd;
  // 通过 steer 通知 agent 工作目录已变更
  if (session) {
    await session.steer(
      `[系统通知] 工作目录已变更为: ${command.cwd}。后续使用 bash/read/write/edit 工具时，请使用此目录作为基准路径。如需执行命令，请先 cd 到该目录。`
    );
  }
  emit({ type: 'cwd_changed', id: command.id, cwd: command.cwd });
}
```

同时修改 `handleSteer`，在上下文信息中追加当前 cwd：

```typescript
const contextText = `[系统上下文更新] 当前文件：${fileList}\n当前工作目录：${currentCwd}${sampleText}`;
```

---

### Step 5: Rust 端传入 DB 目录路径 + 新增 set_cwd 命令

**文件**: `src-tauri/src/services/sidecar_manager.rs`

启动 sidecar 时传入 `--db-dir` 参数：

```rust
if let Some(db_dir) = self.db_dir.read().ok().and_then(|g| g.clone()) {
    cmd.arg("--db-dir").arg(&db_dir);
}
```

新增 `send_set_cwd` 方法：

```rust
pub async fn send_set_cwd(&self, cwd: String) -> AppResult<()> {
    let id = format!("cwd-{}", current_millis());
    let payload = json!({
        "id": id,
        "type": "set_cwd",
        "cwd": cwd,
    });
    self.write_json_line(payload).await
}
```

在 `AppState` 中新增 `db_dir` 字段，在 `lib.rs` setup 时设置：

```rust
// lib.rs setup 中
let db_dir = data_dir.map(|d| d.to_string_lossy().to_string());
// 设置到 sidecar_manager
```

---

### Step 6: 前端在 Excel 加载时触发 cwd 变更

**文件**: `src/stores/excelStore.ts`

在 `addFile` 成功后，取第一个 Excel 文件的父目录作为 cwd：

```typescript
addFile: async (path: string) => {
  // ...existing logic...
  // 如果是第一个文件，通知 Rust 更新 cwd
  if (get().files.length === 0) {
    const parentDir = path.substring(0, path.replace(/[/\\]/, '/').lastIndexOf('/'));
    await setCwd(parentDir);
  }
  // ...existing logic...
},
```

新增 Tauri command 调用 `sidecar_manager.send_set_cwd`。

---

### Step 7: 新增 Tauri command

**文件**: `src-tauri/src/commands/` 新增或修改

```rust
#[tauri::command]
pub async fn set_agent_cwd(cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    state.sidecar_manager
        .send_set_cwd(cwd)
        .await
        .map_err(|e| e.to_string())
}
```

---

### Step 8: 修改 steer 上下文包含 cwd

**文件**: `src/stores/excelStore.ts` → `notifyContextChange()`

在构建 `AgentContext` 时加入 cwd：

```typescript
const context: AgentContext = {
  loadedFiles,
  cwd: currentCwd,  // 新增
};
```

---

### Step 9: 修改 system prompt 说明工作目录语义

**文件**: `src-agent/src/prompts/system.ts`

在注意事项中追加：

```
- 当前工作目录（cwd）为用户 Excel 文件所在目录，使用 bash/read/write/edit 时请注意路径基准
- 如需操作项目文件，请使用绝对路径
```

---

### Step 10: 解析 --db-dir 参数

**文件**: `src-agent/src/main.ts`

在 `parseArgs` 中新增：

```typescript
function parseArgs(): { bridgePort: number; dbDir: string } {
  const portIndex = process.argv.indexOf('--bridge-port');
  const bridgePort = portIndex !== -1 ? parseInt(process.argv[portIndex + 1], 10) : 0;
  const dbDirIndex = process.argv.indexOf('--db-dir');
  const dbDir = dbDirIndex !== -1 ? process.argv[dbDirIndex + 1] : process.cwd();
  return { bridgePort, dbDir };
}
```

将 `dbDir` 传给 `createSheetAgent` 作为默认 cwd。

---

## 关键文件清单

| 文件 | 变更 |
|------|------|
| `src-agent/src/protocol.ts` | 新增 `set_cwd` 命令和 `cwd_changed` 事件，`AgentContext` 加 `cwd` |
| `src-agent/src/agent.ts` | 改用 `DefaultResourceLoader` + `skillsOverride` 注入 skill，`cwd` 改为 dbDir |
| `src-agent/src/main.ts` | 解析 `--db-dir`，新增 `handleSetCwd`，steer 中追加 cwd 信息 |
| `src-agent/src/prompts/system.ts` | 系统提示中说明工作目录语义 |
| `src-tauri/src/services/sidecar_manager.rs` | 传入 `--db-dir`，新增 `send_set_cwd`，`AppState` 加 `db_dir` |
| `src-tauri/src/lib.rs` | setup 时设置 `db_dir` 到 sidecar_manager |
| `src-tauri/src/commands/` | 新增 `set_agent_cwd` command |
| `src/stores/excelStore.ts` | 加载 Excel 时触发 `setCwd`，`notifyContextChange` 含 cwd |
| `src/services/tauri.ts` | 新增 `setAgentCwd` 调用 |

## Skill 持久化方案总结

| cwd 变化场景 | python-processing skill 可用性 |
|---|---|
| 默认启动（cwd = DB 数据目录） | 通过 `skillsOverride` 注入，始终可用 |
| 加载 Excel（cwd 变为 Excel 目录） | 同上，不依赖 cwd 目录扫描 |
| 多次切换 Excel | 同上，skill 与 cwd 解耦 |

## 验证方式

1. 启动应用，不加载 Excel → 确认 agent cwd 为 DB 数据目录（可通过 steer 上下文确认）
2. 加载一个 Excel 文件 → 确认 cwd 自动变为 Excel 所在目录（steer 通知 + cwd_changed 事件）
3. 让 agent 执行 Python 脚本 → 确认 bash 工具在正确目录下执行
4. 让 agent 使用 python-processing skill → 确认 skill 被正确识别和调用
5. 加载不同路径的第二个 Excel → 确认 cwd 不变（仍为第一个 Excel 目录）
