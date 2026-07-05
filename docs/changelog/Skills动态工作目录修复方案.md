# 动态工作目录下 Skills 加载分析（架构记录）

## 背景

用户加载 Excel 后，前端通过 `set_agent_cwd` 将 sidecar 的 `currentCwd` 切换为 Excel 所在目录，用于工具（bash/read/write/edit）的运行时路径解析。

## 架构分析

### 当前行为验证

| 资源 | 加载路径 | cwd 切换后行为 | 状态 |
|------|---------|----------------|------|
| `AGENTS.md` | `{initialCwd}/.pi/AGENTS.md`（通过 `agentsFilesOverride` 显式读取） | 不受影响 | ✅ 正确 |
| `SYSTEM.md` | `{initialCwd}/.pi/SYSTEM.md`（通过 `systemPromptOverride` 显式读取） | 不受影响 | ✅ 正确 |
| `skills/*/SKILL.md` | `{initialCwd}/.pi/skills/`（通过 `loader.cwd` 构造时冻结） | 不受影响 | ✅ 正确 |

### 关键链路

1. **`agent.ts:73-93`** — `DefaultResourceLoader` 构造时 `cwd` 固定为 `initialCwd`（即 `--db-dir` 参数，对应 `app_data_dir`），**永不更新**
2. **`agent.ts:95`** — `loader.reload()` 只调用一次，skills 在此次加载后缓存
3. **`main.ts:422-434`** — `set_cwd` 仅更新 `currentCwd` 变量（用于工具上下文），**不调用** `loader.reload()` 或 `session.reload()`

### 结论

**当前架构已经正确。** 不存在 skills 随 cwd 切换而丢失的问题。`set_cwd` 与资源加载是完全解耦的两条路径：

```
set_cwd → currentCwd (工具执行路径)
        ↛ loader.cwd (资源扫描路径，冻结)
```

### 潜在风险

库 `@earendil-works/pi-coding-agent` 在 `agent-session.js:1930-1935` 暴露了 `session.reload()` → `this._resourceLoader.reload()` 路径。若未来代码在 cwd 变更后误调此方法，skills 会从错误的 cwd 重新扫描。已在 `handleSetCwd` 添加注释守卫防范此风险。

## 关联章节

- DESIGN.md §8.2.2 动态工作目录
- DESIGN.md §8.2.3 System Prompt 三层注入
- DESIGN.md §8.2.4 技能自动发现
