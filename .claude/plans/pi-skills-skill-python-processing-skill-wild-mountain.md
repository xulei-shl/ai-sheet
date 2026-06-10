# Skills 管理功能实现计划

## Context

当前 `.pi/skills/` 下有 `python-processing` 技能，但没有任何 UI 管理界面。技能在 `agent.ts` 中硬编码加载，用户无法在前端查看、新增或删除技能。本次变更添加"技能管理"Tab 页面，实现技能的查看/新增/删除，并将 `agent.ts` 中的硬编码技能加载改为框架自动发现。

**关键设计点**：每个技能是一个完整目录（如 `.pi/skills/python-processing/`），根目录必有 `SKILL.md`，但目录下可以有任意数量的子文件和子目录。因此需要**文件夹树形浏览**能力，而非简单的列表。

---

## 1. Rust 后端：新增 Skill 命令模块

### 新建 `src-tauri/src/models/skill.rs`

```rust
struct SkillInfo { name: String, description: String }
struct SkillDetail { name: String, description: String, content: String, raw: String }
struct SkillInput { name: String, description: String, content: String }
struct FileNode { name: String, path: String, is_dir: bool, children: Vec<FileNode> }
```

`FileNode` 用于表示技能目录下的文件树结构，前端据此渲染树形浏览。

### 新建 `src-tauri/src/commands/skill.rs`

五个 Tauri 命令：

| 命令 | 说明 |
|------|------|
| `list_skills(project_root)` | 读取 `.pi/skills/` 下所有子目录，解析每个 `SKILL.md` 的 frontmatter |
| `read_skill(project_root, name)` | 读取指定技能的 `SKILL.md` 全文 |
| `read_skill_file(project_root, name, file_path)` | 读取技能目录下任意文件内容（file_path 相对于技能目录） |
| `create_skill(project_root, input)` | 创建 `.pi/skills/{name}/SKILL.md`，自动生成 frontmatter |
| `delete_skill(project_root, name)` | 删除 `.pi/skills/{name}/` 整个目录，含安全检查 |

**额外新增 `list_skill_files` 命令**：递归读取 `.pi/skills/{name}/` 目录结构，返回 `FileNode` 树。这样前端可以渲染完整的文件树。

Frontmatter 解析用字符串分割（`---` 分隔），不引入 YAML 依赖。技能名校验：小写字母、数字、连字符，不为空。

### 注册模块和命令

- `src-tauri/src/commands/mod.rs` — 添加 `pub mod skill;`
- `src-tauri/src/models/mod.rs` — 添加 `pub mod skill;`
- `src-tauri/src/lib.rs` — 在 `generate_handler![]` 中注册 5 个命令

**注意**：`project_root` 由前端传入（Tauri 环境下可通过 `import.meta.env` 或路径解析获取），不修改 `AppState`。

---

## 2. 前端类型和服务层

### 新建 `src/types/skill.ts`

```ts
interface SkillInfo { name: string; description: string }
interface SkillDetail { name: string; description: string; content: string; raw: string }
interface SkillInput { name: string; description: string; content: string }
interface FileNode { name: string; path: string; is_dir: boolean; children: FileNode[] }
```

### 修改 `src/services/tauri.ts`

添加 5 个 invoke 封装：`listSkills`、`readSkill`、`readSkillFile`、`createSkill`、`deleteSkill`、`listSkillFiles`

---

## 3. 前端状态管理

### 新建 `src/stores/skillStore.ts`

遵循 `promptStore.ts` 模式，额外增加文件树状态：

- `skills: SkillInfo[]` / `detail: SkillDetail | null` / `fileTree: FileNode[]`
- `selectedFile: string | null` — 当前查看的子文件路径（null 表示查看 SKILL.md）
- `selectedFileContent: string | null` — 当前选中子文件的内容
- `fetchSkills()` / `selectSkill(name)` / `createSkill(input)` / `deleteSkill(name)`
- `selectFile(path)` — 切换查看技能目录内的子文件，调用 `readSkillFile`

---

## 4. Tab 注册

### 修改 `src/stores/uiStore.ts`

`AppTab` 类型添加 `'skills'`

### 修改 `src/layouts/AppLayout.tsx`

- 导入 `SkillsPage` 和图标（`Wrench`）
- `tabs` 数组添加 `{ id: 'skills', label: '技能管理', icon: Wrench, description: '查看、新增和删除 AI 技能工作流' }`
- 添加 `{currentTab === 'skills' && <SkillsPage />}`

---

## 5. 技能管理页面

### 新建 `src/pages/SkillsPage.tsx`

**整体布局**：三栏式

```
┌──────────────┬──────────────────────────────────────┐
│  技能列表     │  右侧面板                             │
│  (w-72)      │                                      │
│              │  ┌─────────────┬────────────────────┐ │
│  python-     │  │ 文件树       │  文件内容预览       │ │
│  processing  │  │ (w-56)      │                    │ │
│              │  │             │                    │ │
│  my-skill    │  │ 📄SKILL.md  │  # Markdown内容    │ │
│              │  │ 📄config.py │  代码或文本预览...   │ │
│              │  │ 📁templates │                    │ │
│              │  │  └📄a.md   │                    │ │
│              │  │             │                    │ │
│  [+新建]     │  └─────────────┴────────────────────┘ │
└──────────────┴──────────────────────────────────────┘
```

**左侧栏（w-72）**：技能列表
- 标题"技能库" + 计数 + "新建"按钮 + 刷新按钮
- 搜索输入框
- 技能列表项：名称 + 截断描述
- 删除按钮（hover 显示）

**右侧面板**：选中技能后分为上下或左右两部分

**文件树区域**：
- 递归渲染 `FileNode` 树，遵循 DataPage 的 `ChevronRight`/`ChevronDown` 展开/折叠模式
- 文件夹节点可展开/折叠，文件节点点击查看内容
- `SKILL.md` 默认高亮/选中
- 图标：文件夹用 `Folder`/`FolderOpen`，文件用 `FileText`，`.py` 用 `FileCode`

**文件内容预览区域**：
- 若选中 `SKILL.md`：显示名称 + 描述 + Markdown 预览/原文 Tab（用 `MarkdownRenderer`）
- 若选中其他文件：根据扩展名展示内容
  - `.md` → MarkdownRenderer
  - `.py`/`.js`/`.ts`/`.json` 等 → `<pre>` 等宽字体显示
  - 其他 → 纯文本显示
- 编辑按钮（仅 `SKILL.md` 可编辑）：切换到编辑模式，textarea 编辑 content

**创建模式**：
- 右侧面板变为表单：Name 输入框 + Description 输入框 + Content 文本域
- 保存后创建目录和 SKILL.md

**删除确认**：`window.confirm` 确认

---

## 6. 更新 Agent 技能加载

### 修改 `src-agent/src/agent.ts`

- 删除 `pythonSkill` 对象构建（64-78 行）
- 删除 `skillsOverride` 回调（83-89 行）
- `DefaultResourceLoader` 仅传 `cwd` 和 `agentDir`
- 框架 `DefaultResourceLoader` 会自动扫描 `{cwd}/.pi/skills/*/SKILL.md`，所有新创建的技能自动被发现

---

## 实施顺序

1. Rust 后端（models/skill.rs → commands/skill.rs → 注册）
2. 前端类型和服务（types/skill.ts → tauri.ts）
3. 状态管理（skillStore.ts）
4. Tab 注册（uiStore.ts → AppLayout.tsx）
5. 页面组件（SkillsPage.tsx）
6. Agent 更新（agent.ts）

## 验证方式

1. 启动应用，切换到"技能管理"Tab，确认 `python-processing` 出现在列表中
2. 点击技能，确认文件树显示 `SKILL.md`（和任何其他子文件/子目录）
3. 点击文件树中的不同文件，确认内容预览切换正常
4. 新建一个测试技能，确认目录和 SKILL.md 在 `.pi/skills/` 下创建
5. 删除测试技能，确认整个目录被移除
6. 在 AI 对话中输入 `/skill:`，确认所有技能均可发现
7. 确认 `python-processing` 仍被 agent 自动加载（无需硬编码）
