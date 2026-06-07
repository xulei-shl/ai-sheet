# AI-Sheet 项目分析报告

## Context

用户计划将 AI-Sheet 从当前的 Python Tkinter 桌面应用升级为现代桌面端技术栈。本报告对现有代码进行全方位深度分析，为后续技术选型和架构设计提供参考依据。

---

## 一、项目概览

**AI-Sheet** 是一个基于大语言模型（LLM）的智能电子表格桌面工具，核心功能是将 AI 能力融入 Excel 数据处理流程。用户通过自然语言描述需求，系统自动生成公式、批量调用 AI 处理文本、或自动生成并执行 Python 脚本。

**当前技术栈**：Python 3.12 + Tkinter + OpenAI SDK + Pandas/OpenPyXL

**运行方式**：`python main.py`，无构建步骤，无打包分发

---

## 二、目录结构与模块职责

```
ai-sheet/
├── main.py                          # 入口，AISheetApp 主控制器（435行）
├── requirements.txt                 # 7个依赖包
├── setup_preinstalled_packages.py   # Windows 性能优化脚本
│
├── config/                          # JSON 配置文件
│   ├── models_config.json          # LLM 模型 API 配置（6个预置模型）
│   ├── prompts.json                # 11个提示词模板
│   └── formula_config.json         # 公式模板与处理设置
│
├── ui/                             # Tkinter UI 层（8个Tab + 组件）
│   ├── multi_excel_tab.py          # 多Excel上传与选择
│   ├── formula_generation_tab.py   # 公式生成界面
│   ├── formula_processing_tab.py   # 公式批量处理界面
│   ├── prompt_generation_tab.py    # 提示词生成界面
│   ├── llm_processing_tab.py       # LLM 批量处理界面
│   ├── python_processing_tab.py    # Python 代码自动化界面
│   ├── config_tab.py               # 模型配置管理界面
│   ├── prompt_management_tab.py    # 提示词管理界面
│   ├── multi_excel_selector.py     # 多Excel文件/Sheet选择器组件
│   ├── markdown_text.py            # Markdown 文本渲染组件
│   └── components/
│       └── multi_excel_column_selector.py  # 列选择器组件
│
├── modules/                        # 核心业务逻辑层（15个模块）
│   ├── config_manager.py           # 多模型配置管理器（CRUD + 验证 + 备份）
│   ├── prompt_manager.py           # 提示词模板管理器
│   ├── excel_processor.py          # Excel 读写操作（单文件 + 批量）
│   ├── excel_utils.py              # Excel 工具函数
│   ├── formula_generator.py        # 公式生成逻辑
│   ├── formula_processor.py        # 公式批量处理逻辑
│   ├── formula_engine.py           # 公式引擎
│   ├── llm_batch_processor.py      # LLM 批量处理编排器
│   ├── python_code_processor.py    # Python 代码生成总控制器（Orchestrator）
│   ├── python_code_executor.py     # Python 代码执行器（带依赖管理）
│   ├── package_manager.py          # Python 包安装管理器
│   ├── multi_excel_utils.py        # 多Excel文件工具
│   ├── prompt_generator.py         # 提示词生成逻辑
│   ├── column_utils.py             # 列选择工具
│   ├── data_validator.py           # 数据验证
│   ├── excel_formula_reader.py     # Excel 公式读取
│   └── task_scheduler.py           # 任务调度
│
├── units/                          # 底层组件
│   └── llm_client.py              # LLM API 客户端（OpenAI兼容）
│
├── preinstalled_packages/          # Windows 预缓存包
│   └── windows/py312/
│
├── docs/                           # 文档（10+ markdown）
├── logs/                           # 运行时日志
└── test/                           # 测试目录（空）
```

---

## 三、核心业务流程分析

### 3.1 三大核心处理路径

| 路径 | 复杂度 | 说明 |
|------|--------|------|
| **公式生成** | 中 | 自然语言 → LLM → Excel公式 → 批量应用到列 |
| **LLM批量处理** | 高 | Excel列数据 → 逐行调用AI → 写回结果 → 断点续传 |
| **Python代码自动化** | 极高 | 需求分析 → 类型分类 → 代码生成 → 自动测试/修复循环 → 执行 → 文档生成 |

### 3.2 公式生成流程
```
用户选择Excel列 → 提取列结构+样本数据 → 构建增强上下文
→ LLM生成公式（使用"Excel公式生成"提示词）→ 结果缓存 → 用户确认 → 批量应用
```

### 3.3 LLM批量处理流程
```
多Excel上传 → 选择Sheet和列 → 选择/生成提示词 → 逐行处理循环
├── 读取行数据（多列用"|||"拼接）
├── 调用LLM API（支持温度/top_p调节）
├── 写入结果到新列
├── 每行保存（增量保存）
└── 跳过已处理行（断点续传）
→ 完成统计报告
```

### 3.4 Python代码自动化流程
```
用户描述需求 → 类型分析（增强/重构）→ 生成完整Python脚本
→ 自动测试循环（最多3次修复）
├── 安装依赖（package_manager）
├── 执行脚本
├── 失败则AI修复代码
└── 重试
→ 正式执行 → 生成README文档 → 变更日志
```

---

## 四、架构设计分析

### 4.1 当前架构模式

**MVC 变体**，但边界模糊：

| 层 | 目录 | 实际职责 |
|----|------|---------|
| View | `ui/` | UI渲染 + 事件处理 + 部分业务逻辑 |
| Controller | `main.py` | Tab编排 + 回调分发 + 数据桥接 |
| Model | `modules/` | 业务逻辑 + 数据访问 + 配置持久化 |
| Utility | `units/` | LLM API客户端 |

**关键问题**：
- UI层与业务逻辑耦合较重，Tab组件内包含业务调用
- 无统一的状态管理，依赖 `shared_data` 字典在Tab间传递
- 回调链通过 `hasattr` 检查实现，缺乏类型安全

### 4.2 数据流架构

```
                  ┌──────────────┐
                  │  main.py     │
                  │ (AISheetApp) │
                  └──────┬───────┘
                         │ shared_data + callbacks
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │  UI Tabs   │ │  UI Tabs   │ │  UI Tabs   │
   │ (8个Tab)   │ │ (8个Tab)   │ │ (8个Tab)   │
   └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
         │              │              │
         ▼              ▼              ▼
   ┌──────────────────────────────────────────┐
   │           modules/ (业务逻辑)             │
   │  config_manager / prompt_manager /       │
   │  excel_processor / llm_batch_processor / │
   │  formula_generator / python_code_proc    │
   └──────────────────┬───────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │ units/        │
              │ llm_client    │──── OpenAI API
              └───────────────┘
```

### 4.3 模块间依赖关系

```
main.py
├── ui.multi_excel_tab ──────► modules.multi_excel_utils
├── ui.formula_generation_tab ──► modules.formula_generator ──► units.llm_client
├── ui.formula_processing_tab ──► modules.formula_processor ──► modules.excel_processor
├── ui.prompt_generation_tab ───► modules.prompt_generator ──► units.llm_client
├── ui.llm_processing_tab ──────► modules.llm_batch_processor ──► units.llm_client
│                                                           └─► modules.excel_processor
├── ui.python_processing_tab ───► modules.python_code_processor
│                                ├─► modules.python_code_executor
│                                ├─► modules.package_manager
│                                └─► units.llm_client
├── ui.config_tab ──────────────► modules.config_manager
└── ui.prompt_management_tab ───► modules.prompt_manager
```

---

## 五、各模块深度分析

### 5.1 LLM客户端 (`units/llm_client.py`, 420行)

**核心能力**：
- OpenAI SDK 兼容调用，支持多模型多端点
- 指数退避重试（最多3次），区分速率限制/网络/其他错误
- 客户端实例缓存（按 api_key:base_url 为键）
- 详细参数日志记录（`logs/llm_params.log`）
- Token粗略估算（中文1字=1token，英文4字符=1token）
- 连接测试功能

**待改进**：
- 无流式响应支持（SSE）
- 无并发请求能力
- 日志记录同步写文件，可能影响性能
- Token估算过于粗糙

### 5.2 配置管理器 (`modules/config_manager.py`, 484行)

**核心能力**：
- 多模型 CRUD + 名称唯一性校验
- JSON 文件持久化 + 自动完整性修复
- 备份/恢复 + 导入/导出
- API 连接测试
- 文件权限设置

**数据模型**：
```json
{
  "models": [{ "name", "api_key", "base_url", "model_id", "created_at", "updated_at" }],
  "default_paths": { "excel_path", "output_dir" },
  "settings": { "default_model_index", "auto_save" },
  "excel": { "supported_formats", "max_rows", "max_file_size_mb", "preview_rows" }
}
```

**待改进**：
- API Key 明文存储于JSON
- 无加密/安全存储
- 配置变更无通知机制（依赖手动回调链）

### 5.3 提示词管理器 (`modules/prompt_manager.py`)

**核心能力**：
- 11个预置提示词模板（公式生成、代码编写、代码修复、类型分析等）
- UUID 标识 + CRUD 操作
- 名称/内容长度验证
- 统计信息

**提示词分类**：
| 类别 | 提示词 |
|------|--------|
| 公式 | Excel公式生成 |
| 代码 | Python代码编写、Python代码修复、Python处理类型分析、Python列名生成 |
| 文本提取 | 主题词提取、人名提取（题名/备注） |
| 提示词工程 | 提示词生成、提示词生成优化版 |
| 其他 | 火花题名生成 |

### 5.4 Excel处理器 (`modules/excel_processor.py`, 306行)

**核心能力**：
- openpyxl 加载/保存/读写
- 多列数据提取（"|||"分隔符拼接）
- 自动创建结果列（自定义列名）
- 断点续传检测（检查行是否已处理）
- 批量处理封装（ExcelBatchProcessor）
- 上下文管理器模式
- 每3行增量保存

**待改进**：
- 单线程顺序处理，无并行能力
- 大文件性能瓶颈（openpyxl 全量加载）
- 无内存优化策略

### 5.5 Python代码处理器 (`modules/python_code_processor.py`)

**核心能力**（Orchestrator模式）：
- 两阶段处理：类型分析 → 代码生成
- 自动测试循环（生成→执行→修复，最多3次）
- 依赖自动安装（package_manager）
- 文档生成（README.md + 变更日志）

**工作流状态**：
```
analyze_processing_type → generate_code → [test → fix → retest] → execute → document
```

**待改进**：
- 代码执行无沙箱隔离
- 依赖安装可能影响宿主环境
- 无执行超时/资源限制

---

## 六、UI层深度分析

### 6.1 UI框架特征

| 特征 | 当前实现 |
|------|---------|
| 框架 | Tkinter + ttk |
| 布局 | pack + grid + PanedWindow |
| 字体 | 微软雅黑(中文) + Consolas(代码) |
| 导航 | 8 Tab（ttk.Notebook） |
| 样式 | ttk主题 + 程序化样式 |
| 国际化 | 仅中文 |
| 自适应 | 可调整窗口 + PanedWindow分栏 |
| 图标 | Unicode Emoji（📊🧮🤖🐍⚙️📝） |

### 6.2 8个Tab功能矩阵

| Tab | 输入 | 处理 | 输出 | 复杂度 |
|-----|------|------|------|--------|
| 多Excel上传 | 文件选择 | 解析Sheet/列 | 数据预览 | 中 |
| 公式生成 | 列选择+需求描述 | LLM生成公式 | 公式+说明 | 中 |
| 公式处理 | Excel+公式 | 批量应用 | 修改后的Excel | 中 |
| 提示词生成 | 多字段输入 | LLM生成提示词 | 结构化提示词 | 中 |
| 大模型处理 | Excel+列+提示词 | 逐行LLM调用 | 处理结果列 | 高 |
| Python处理 | 需求描述 | 代码生成+执行 | 处理结果+文档 | 极高 |
| 配置管理 | 表单输入 | CRUD+测试 | JSON持久化 | 低 |
| 提示词管理 | 表单输入 | CRUD | JSON持久化 | 低 |

### 6.3 关键交互模式

- **异步处理**：长时间操作使用 `threading.Thread`，通过队列更新UI
- **进度追踪**：进度条 + 百分比 + 速度指标（行/分钟）
- **实时日志**：颜色编码的滚动文本区域
- **数据共享**：`shared_data` 字典 + 回调函数链
- **配置联动**：配置/提示词变更 → 触发回调 → 刷新所有相关Tab

---

## 七、数据存储分析

### 7.1 存储方式

| 数据 | 格式 | 位置 | 特点 |
|------|------|------|------|
| 模型配置 | JSON | `config/models_config.json` | CRUD + 备份恢复 |
| 提示词 | JSON | `config/prompts.json` | 11个预置 + 自定义 |
| 公式配置 | JSON | `config/formula_config.json` | 模板 + 处理设置 |
| 处理结果 | Excel | 用户指定路径 | 增量保存 |
| 运行日志 | 文本 | `logs/*.log` | 同步追加写入 |
| 临时文件 | 多种 | `logs/` | 会话结束清理 |

### 7.2 数据安全风险

- **API Key 明文存储**：`models_config.json` 中 api_key 未加密
- **日志包含敏感信息**：`llm_params.log` 记录完整请求内容
- **无访问控制**：配置文件无权限管理

---

## 八、现有架构的痛点与局限

### 8.1 UI/UX 层面

| 痛点 | 影响 |
|------|------|
| Tkinter UI 过时 | 视觉效果差，与现代桌面应用差距大 |
| 无响应式设计 | 不同分辨率体验不一致 |
| 缺乏动效/过渡 | 交互生硬 |
| 无暗色主题 | 无主题切换能力 |
| 中文字体依赖 | 跨平台字体不一致 |
| 无拖放支持 | 文件上传只能通过对话框 |
| 列选择器体验差 | 大量列时 checkbox 操作繁琐 |

### 8.2 架构层面

| 痛点 | 影响 |
|------|------|
| UI与业务逻辑耦合 | 难以独立测试和演进 |
| 无统一状态管理 | Tab间数据传递依赖字典+回调，脆弱 |
| 回调链冗长 | 配置/提示词变更需手动通知每个Tab |
| 无依赖注入 | 模块间硬编码依赖 |
| 无事件总线 | 组件间通信缺乏统一机制 |

### 8.3 性能层面

| 痛点 | 影响 |
|------|------|
| 同步日志写入 | 可能阻塞处理线程 |
| openpyxl全量加载 | 大文件内存占用高 |
| 无并发LLM请求 | 批量处理速度慢 |
| 无流式响应 | 用户等待体验差 |
| 无请求队列 | 并发请求管理缺失 |

### 8.4 安全层面

| 痛点 | 影响 |
|------|------|
| API Key明文 | 凭据泄露风险 |
| Python代码无沙箱 | 恶意代码执行风险 |
| 无输入校验框架 | 数据注入风险 |
| 日志含敏感内容 | 信息泄露风险 |

### 8.5 工程化层面

| 痛点 | 影响 |
|------|------|
| 无测试框架 | test/目录为空 |
| 无CI/CD | 无自动化构建和发布 |
| 无打包分发 | 用户需自建Python环境 |
| 无类型注解覆盖 | 代码可维护性差 |
| 无API版本管理 | 接口变更风险 |

---

## 九、可复用的核心资产

升级改造时，以下模块的逻辑可**直接移植**或**参考重写**：

### 9.1 可直接移植（纯逻辑，无UI依赖）

| 模块 | 文件 | 说明 |
|------|------|------|
| LLM客户端核心逻辑 | `units/llm_client.py` | 重试、缓存、参数构建逻辑 |
| 配置管理业务逻辑 | `modules/config_manager.py` | CRUD、验证、备份恢复 |
| 提示词管理业务逻辑 | `modules/prompt_manager.py` | 模板管理、验证 |
| Excel处理核心逻辑 | `modules/excel_processor.py` | 读写、断点续传、批量处理 |
| Python代码执行器 | `modules/python_code_executor.py` | 执行、依赖管理 |

### 9.2 需参考重写（含UI耦合）

| 模块 | 文件 | 重写要点 |
|------|------|---------|
| 公式生成Tab | `ui/formula_generation_tab.py` | 提取业务逻辑，UI层重写 |
| LLM批量处理Tab | `ui/llm_processing_tab.py` | 分离进度追踪逻辑 |
| Python处理Tab | `ui/python_processing_tab.py` | 分离编排逻辑 |
| 主控制器 | `main.py` | 整体架构重设计 |

### 9.3 配置数据模型（可直接复用）

- `models_config.json` 结构 → 可迁移至 SQLite/localStorage
- `prompts.json` 结构 → 可迁移至数据库
- `formula_config.json` 结构 → 可迁移至配置系统

---

## 十、技术债评估

| 级别 | 项目 | 数量 | 说明 |
|------|------|------|------|
| **严重** | 无测试覆盖 | 全项目 | test/目录为空 |
| **严重** | API Key明文 | config_manager | 安全隐患 |
| **严重** | 代码无沙箱 | python_code_executor | 安全隐患 |
| **中等** | UI与逻辑耦合 | 所有ui/文件 | 可维护性差 |
| **中等** | 无状态管理 | main.py | 数据流混乱 |
| **中等** | 无流式响应 | llm_client | 用户体验差 |
| **轻微** | 日志过于详细 | llm_client | 隐私+性能 |
| **轻微** | 字体硬编码 | ui/ | 跨平台问题 |

---

## 十一、升级改造参考建议

### 11.1 已确定技术栈

**Tauri 2.0 + React + pi-agent + Rust**

| 层次 | 技术 | 用途 |
|------|------|------|
| 桌面框架 | Tauri 2.0 | 应用壳、IPC、系统API |
| 前端 | React 19 + Ant Design 5 + Zustand | 三栏布局 UI |
| AI Agent | pi-agent SDK (Node.js Sidecar) | 多轮对话、工具调用、流式输出、上下文压缩 |
| 后端 | Rust | Excel I/O、配置管理、SQLite、安全存储 |
| Python 执行 | pi-agent bash 工具 | 替代自研 Python Sidecar，Agent 直接执行 |

**选型理由**：
- Tauri：轻量（安装包 ~20-30MB）、安全、跨平台
- pi-agent：内置多轮对话、工具调用、Auto-Compaction、多 Provider 支持，消除自研 LLM 服务层
- Rust：Excel 读写性能最优，安全存储原生支持
- bash 工具替代 Python Sidecar：Agent Loop 自动生成/执行/修复代码，无需维护独立执行框架

### 11.2 架构升级建议方向

1. **三进程架构**：Rust (Tauri Core) + Node.js (pi-agent Sidecar) + React (WebView)
2. **三栏布局**：左栏 Tab 导航 + 中栏数据窗口 + 右栏 AI Agent 对话
3. **pi-agent 驱动 AI**：所有 LLM 交互由 pi-agent 处理，自定义工具桥接 Rust 后端
4. **HTTP Bridge**：Node.js Sidecar 通过 localhost HTTP 调用 Rust 数据服务
5. **统一状态管理**：Zustand（React 侧），pi-agent SessionManager（对话侧）
6. **事件驱动**：pi-agent 事件 → stdout → Rust Event Bridge → Tauri Events → React
7. **安全增强**：Keychain 加密 API Key + pi-agent bash 工具隔离 + HTTP Bridge localhost 限制
8. **流式响应**：pi-agent EventStream 内置，无需自研 SSE 解析 ✅（pi-agent 已解决）
9. **并发处理**：pi-agent 工具支持 parallel 执行 + BatchRunner 批量并发 ✅（pi-agent 已解决）
10. **数据持久化**：SQLite（业务数据）+ pi-agent JSONL（对话历史）
11. **自动更新**：tauri-plugin-updater
12. **打包分发**：Windows NSIS + macOS DMG

**pi-agent 已解决的痛点**（无需自研）：
- ~~多轮对话管理~~ → AgentSession 内置
- ~~SSE 流式解析~~ → EventStream 内置
- ~~工具调度框架~~ → AgentTool + Agent Loop 内置
- ~~上下文压缩~~ → Auto-Compaction 内置
- ~~会话持久化~~ → SessionManager JSONL 内置
- ~~Python 代码执行框架~~ → bash 工具 + Agent Loop 自动修复
- ~~LLM 重试/错误处理~~ → Provider 内置
- ~~多 LLM Provider 支持~~ → 9 类 API 内置

---

## 十二、代码规模统计

| 目录 | 文件数 | 估算行数 | 说明 |
|------|--------|---------|------|
| `ui/` | 11 | ~5000 | UI组件（含业务逻辑） |
| `modules/` | 17 | ~6000 | 核心业务逻辑 |
| `units/` | 1 | ~420 | 底层工具 |
| `main.py` | 1 | ~435 | 主控制器 |
| `config/` | 3 | ~300 | 配置文件 |
| **总计** | ~33 | ~12000+ | Python源码 |

---

## 十三、验证方式

本分析报告基于以下验证手段：
1. 全量目录扫描与文件读取
2. 核心模块源码逐行阅读（main.py, llm_client.py, config_manager.py, excel_processor.py, python_code_processor.py）
3. 配置文件结构分析（models_config.json, prompts.json, formula_config.json）
4. 依赖关系追踪（import 语句分析）
5. UI组件结构分析（所有 ui/ 文件）
