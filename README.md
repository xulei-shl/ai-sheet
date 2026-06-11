# AI-Sheet

> 自然语言驱动的 Excel 智能处理桌面应用。

AI-Sheet 将 LLM Agent 与 Excel 处理能力深度结合，让你通过自然语言对话完成公式生成、批量文本处理、数据清洗等复杂表格任务。

**产品定位**：专业数据分析师和工程师的桌面效率工具，追求极低延迟和"现代开发者工具"般的极致体验。

---

## 功能概览

### 智能对话 Agent

右栏 AI Agent 支持多轮对话，自动读取当前 Excel 上下文（文件、工作表、列名、样例数据），理解你的需求后：

- **生成 Excel 公式** — 描述计算逻辑，Agent 生成可用公式并一键应用
- **生成提示词** — 构建 LLM 批量处理所需的提示词模板
- **执行 Python 脚本** — 通过 Agent 内置 bash 工具运行 Python 进行数据处理
- **调用自定义工具** — 读写 Excel、应用公式、管理配置等

Agent 具备上下文压缩、流式输出、工具调用卡片可视化、会话持久化（JSONL 格式，重启不丢失对话）等能力。

### 公式生成与应用

- 自然语言描述 → AI 生成 Excel 公式
- 公式预览与一键应用到指定列
- 公式历史记录，支持快速复用
- `{}` 占位符自动按行展开（如 `=A{}+B{}` → `=A2+B2`）

### LLM 批量处理

- 逐行调用 LLM 处理 Excel 数据，结果写回表格
- 支持暂停 / 恢复 / 中止
- 断点续传（中断后从上次位置继续）
- 实时进度、速度、ETA 显示
- 指数退避自动重试（3 次）

### 提示词库

- 创建、编辑、搜索提示词模板
- 与 Agent 对话联动 — Agent 生成的提示词自动保存
- 公式页面、LLM 批量页面下拉选择已有提示词

### 模型配置

- 支持 9 类 LLM Provider（OpenAI、Anthropic、DeepSeek、Google、Mistral 等）
- 每模型独立代理开关（支持 HTTP_PROXY 环境变量）
- API Key 加密存储（Tauri Plugin Store，不入库）
- 一键测试连接

### 技能管理

- 内置技能系统（`.pi/skills/`），Agent 自动发现可用技能
- 可视化浏览技能目录、编辑技能文件
- 从本地文件夹导入技能
- 默认提供 Python 数据处理技能

### 双模式设计

每个核心功能同时支持两种使用方式：

| 模式 | 触发 | 适用场景 |
|------|------|----------|
| 直接执行 | 中栏表单操作 | 已有配置的重复任务 |
| Agent 辅助 | 右栏对话 | 首次生成、迭代优化、复杂需求 |

Agent 生成的提示词/公式可直接落地到中栏执行，中栏批量进度也可反馈给 Agent 上下文。

---

## 界面概览

```
┌────────┬────────────────────────┬──────────────────────┐
│  导航   │  数据 / 页面            │  AI Agent 对话        │
│  (可折) │                        │  (可折为浮动抽屉)      │
└────────┴────────────────────────┴──────────────────────┘
```

- **左栏**：Tab 导航（数据、公式、AI、配置、技能），可折叠为纯图标
- **中栏**：Excel 数据表、公式编辑、批量处理、模型配置等页面
- **右栏**：AI Agent 对话面板，跨页面持久存在
- **深色 / 浅色主题**：支持手动切换或跟随系统
- **响应式**：`<1280px` 右栏自动折叠为浮动抽屉

---

## 安装

### 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10+ |
| Node.js | ≥ 20.x（需在 PATH 中） |
| WebView2 | Windows 11 自带；Windows 10 需[手动安装](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |

### 下载安装

从 [Releases](https://github.com/xulei-shl/ai-sheet/releases) 页面下载最新版本的 NSIS 安装包（`.exe`），双击运行安装。

### 从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/xulei-shl/ai-sheet.git
cd ai-sheet

# 2. 安装前端依赖
npm install

# 3. 安装 Sidecar 依赖
cd src-agent && npm install && cd ..

# 4. 开发模式运行
npm run tauri:dev

# 5. 构建安装包
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录。

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 聚焦 AI 输入框 |
| `Ctrl/Cmd + B` | 切换左栏 |
| `Ctrl/Cmd + \` | 切换右栏 |
| `Escape` | 中断 Agent 生成 / 关闭右栏 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri 2.0 |
| 前端 | React 19 + Vite 6 + Tailwind CSS 4 + Ant Design 5 |
| AI Agent | pi-agent SDK（多轮对话、流式输出、工具调用、上下文压缩） |
| 后端 | Rust（Excel I/O、SQLite、Sidecar 管理） |
| Sidecar | Node.js 20+（pi-agent 运行时，esbuild 打包为单文件） |

> 详细架构设计参见 [DESIGN.md](./DESIGN.md)。

---

## 项目结构

```
ai-sheet/
├── src-tauri/          Rust 后端（Tauri Commands、Excel、SQLite）
├── src-agent/          Node.js Sidecar（pi-agent SDK）
├── src/                React 前端
├── .pi/                Agent 技能与规则（捆绑资源）
├── DESIGN.md           系统设计与架构文档
├── PRODUCT.md          产品定位与设计原则
├── docs/               开发交接、协议细节、历史方案稿
└── AGENT.md            编码行为准则
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [DESIGN.md](./DESIGN.md) | 系统设计与架构（技术细节、数据模型、通信协议） |
| [PRODUCT.md](./PRODUCT.md) | 产品定位、用户画像、设计原则、非功能指标 |
| [AGENT.md](./AGENT.md) | 编码行为准则 |
| [docs/HANDOFF.md](./docs/HANDOFF.md) | 开发者交接手册、本地开发指南、已知问题 |
| [docs/PROTOCOL.md](./docs/PROTOCOL.md) | 跨进程通信与 Sidecar JSONL 协议细节 |

---

## License

Private — All rights reserved.
