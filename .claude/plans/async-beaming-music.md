# Plan: QuickActionBar 动态化 — 从 DB 提示词渲染快捷按钮

## Context

当前 QuickActionBar 中"公式生成"和"提示词生成"两个按钮是硬编码的：
- `QuickActionBar.tsx` 中两个 `<button>` 写死
- `agentQuickActions.ts` 中 `TEMPLATE_NAMES`、`FALLBACK_TEMPLATES`、`taskHeader()` 等全部硬编码
- `findPromptTemplate` 按 `TEMPLATE_NAMES[action]` 精确匹配提示词名称，fallback 到硬编码模板

**目标**：快捷按钮从 DB 中 `category === '快捷操作'` 的提示词动态生成，用户可在提示词管理页面勾选"显示为快捷操作"来添加/移除快捷按钮。

## 关键决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 用已有 `category` 字段，值 `"快捷操作"` 标识快捷操作提示词 | 无需 DB 迁移、无需新增字段 |
| 2 | 图标：按提示词 `name` 做静态映射，未知名称 fallback `Zap` | 快捷按钮少(2-5个)，无需 icon 字段 |
| 3 | 占位提示：按 `name` 做静态映射，未知 fallback "请输入你的需求" | 同上 |
| 4 | 删除 `taskHeader()`，模板内容即完整系统指令 | 简化，消除冗余 |
| 5 | 系统提示词种子化：首次启动时自动向 DB 插入"Excel公式生成"、"提示词生成" | 替代前端 FALLBACK_TEMPLATES |
| 6 | `action` 字段从 `'formula_generation' \| 'prompt_generation'` 扩展为 `string`，使用 `prompt.id` | Rust 侧已是 `String`，无需改 |

## 修改文件清单

### 1. `src-tauri/src/db/prompts_repo.rs` — 新增种子函数

新增 `seed_system_prompts(conn: &Connection)` 函数：
- 定义两个系统提示词常量（内容 = 当前 `FALLBACK_TEMPLATES` 的值）
- 对每个，先 `SELECT COUNT(*) FROM prompts WHERE name = ?`，若为 0 则 INSERT（`is_system = 1`, `category = "快捷操作"`）
- 幂等：已存在则跳过

### 2. `src-tauri/src/db/mod.rs` — 调用种子

在 `run_migrations` 方法内，migrations 成功后调用 `prompts_repo::seed_system_prompts(&conn)`。

### 3. `src/components/agent/agentQuickActions.ts` — 核心重构

**删除**：
- `TEMPLATE_NAMES`、`QuickAction` 类型、`FALLBACK_TEMPLATES`、`taskHeader()`

**新增**：
- `QUICK_ACTION_CATEGORY = '快捷操作'` 常量
- `getQuickActionPrompts(prompts: Prompt[]): Prompt[]` — 过滤 + 排序
- `getIconNameForPrompt(name: string): string` — 图标名映射
- `getPlaceholderForPrompt(name: string): string` — 占位提示映射

**重构**：
- `buildDirectPrompt(template, ctx, userInput)` — 去掉 `action` 参数和 `taskHeader`
- `buildDisplaySummary(actionName, ctx, usedFallback, sampleMissing, userInput)` — `actionName: string`
- `findPromptTemplate` → 不再需要，直接用 prompt 对象的 `content`

### 4. `src/components/agent/QuickActionBar.tsx` — 动态渲染

**删除**：
- `PLACEHOLDER_HINTS` 常量
- 两个硬编码 `<button>`

**新增**：
- `const quickActions = getQuickActionPrompts(prompts)` 获取动态列表
- 图标组件映射 `{ sigma: Sigma, sparkles: Sparkles, zap: Zap }`
- `quickActions.map(prompt => <button key={prompt.id}>...)` 动态渲染
- `handleQuickAction(prompt: Prompt)` 接收 Prompt 对象

### 5. `src/services/tauri.ts` — 扩展 action 类型

`DirectLlmRequest.action` 从 `'formula_generation' | 'prompt_generation'` 改为 `string`。

### 6. `src/stores/agentStore.ts` — 扩展 action 类型

`sendDirectLlmMessage` 签名中 `action` 参数从联合类型改为 `string`。

### 7. `src/pages/PromptsPage.tsx` — 新增快捷操作勾选框

在编辑/新建表单的"分类"输入下方，增加一个勾选框"显示为快捷操作按钮"：
- 勾选时：将 `category` 设为 `"快捷操作"`（覆盖分类输入框的值）
- 取消勾选时：将 `category` 清空为 `""`
- 当 `category === '快捷操作'` 时自动勾选

在列表视图中，`category === '快捷操作'` 的提示词显示特殊徽章（如闪电图标 + "快捷"文字）。

## 实现顺序

1. **Rust: 种子函数** — `prompts_repo.rs` + `mod.rs`
2. **TS: 类型扩展** — `tauri.ts` + `agentStore.ts` 的 action 参数
3. **TS: 核心重构** — `agentQuickActions.ts`
4. **TS: UI 重构** — `QuickActionBar.tsx` 动态按钮
5. **TS: 管理页** — `PromptsPage.tsx` 勾选框
6. **验证** — typecheck + build + 功能验证

## 验证

```bash
npm run typecheck
npm run build
npm --prefix src-agent run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev  # 手动验证
```

功能验证点：
- 首次启动后 DB 中应有两条系统提示词，category 为"快捷操作"
- QuickActionBar 显示两条动态按钮，功能与原来一致
- 在提示词管理页勾选"显示为快捷操作"，新按钮出现在 QuickActionBar
- 取消勾选后按钮消失
- 修改提示词内容后，快捷按钮使用最新内容
