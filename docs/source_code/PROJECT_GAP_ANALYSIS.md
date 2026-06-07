# AI-Sheet v2 项目差距分析报告

> 基于升级方案（Tauri 2.0 + React + pi-agent + Rust）与实际代码库，更新可复用资产分析与迁移目标

---
<!-- PLACEHOLDER_SECTION_0 -->

## 零、架构决策与适用性确认

| 旧方案假设 | 新方案决策 | 实际代码确认 | 影响 |
|-----------|-----------|--------------|------|
| Rust reqwest 实现 LLM 调用 | pi-agent SDK（Node.js Sidecar）处理所有 LLM 交互 | `units/llm_client.py` 实际存在，但新方案完全不使用 | 删除 Rust LLM 服务层 |
| 自建 ConversationService + SQLite 会话表 | pi-agent AgentSession + SessionManager 内置 | 代码中不存在 `conversations` 表 | 删除会话管理模块 |
| Python Sidecar（JSON-RPC 通信） | pi-agent bash 工具直接执行 Python | `python_code_executor.py` 和 `package_manager.py` 存在，但新方案用 pi-agent 替代 | 删除 Python Sidecar |
| ChatPanel 嵌入各功能页面 | 三栏布局：右栏持久 AgentChatPanel | 旧代码各 Tab 无内嵌 ChatPanel | 前端架构调整 |
| 每个功能有独立 LLM 命令 | 统一 Agent 对话 + 自定义工具 | IPC 接口设计确认可行 | IPC 接口大幅简化 |
| 配置/提示词数据模型新增字段 | 新方案期望 `provider_type`、`category` | 实际代码中不存在这些字段 | 迁移时需新增字段 |
| prompts.json 有 11 个预置提示词 | 11 个预置 | **实际仅 8 个**，且有不完整条目 | 提示词补充/整理 |

---
<!-- PLACEHOLDER_SECTION_1 -->

## 一、三种 AI 处理流程

### 1.1 公式生成（pi-agent 多轮对话 → 直接写入 Excel）

```
用户: "统计每个区域销售额"     [右栏对话]
  ↓
Agent 思考 → read_excel 工具查看数据结构
  ↓
Agent 多轮对话: 澄清需求、调整公式
  ↓
Agent 调用 apply_formula 工具 → Rust 写入 Excel
  ↓
中栏刷新显示公式结果
```

**不需要 LLM 批量调用**。公式生成后直接作为 Excel 单元格公式写入。

### 1.2 提示词 + 批量处理（pi-agent 多轮生成提示词 → 简单逐行 LLM 调用）

```
第一阶段：多轮对话生成提示词模板 [右栏对话]
用户: "提取题名中的人名"
  ↓
Agent 多轮对话: 确认输出格式、语言偏好、边界规则
  ↓
Agent 调用 save_prompt 工具 → 保存到提示词库
  ↓

第二阶段：批量处理 [中栏操作]
用户选择 Excel + 列 + 提示词模板 → 启动批量处理
  ↓
BatchRunner: 逐行读取数据 → 拼接提示词 → OpenAI API 调用 → 写回 Excel
  ↓
进度实时上报到前端
```

**关键**：批量处理不走 pi-agent Agent Loop，而是复用 pi-ai Provider 做简单逐行 LLM 调用。这与原项目 `llm_batch_processor.py` 的模式一致，只是 LLM 客户端从 `openai` SDK 换成 pi-ai Provider。

### 1.3 Python 代码执行（pi-agent 多轮对话 → bash 执行）

```
用户: "提取日期列的年月日"     [右栏对话]
  ↓
Agent 生成 Python 代码 → bash: python script.py
  ↓
执行失败？Agent 自动查看错误 → 修改代码 → 重新执行（无限迭代）
  ↓
执行成功 → 告知用户结果
```

**不需要自研执行框架**。pi-agent 的 bash 工具 + Agent Loop 自动修复完全替代了 `python_code_processor.py` + `python_code_executor.py` + `package_manager.py`。

---
<!-- PLACEHOLDER_SECTION_2 -->

## 二、实际可复用代码清单（基于源码核查）

### 2.1 配置管理 ✅ 高复用

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `config_manager.py` | 484 | **CRUD 逻辑完全可复用** | `services/config_service.rs` |

**迁移要点**：
- 存储层从 JSON → SQLite，业务逻辑不变
- API Key 改用 tauri-plugin-store 加密存储（现有 API Key 明文存储于 `models_config.json`）
- **实际代码中无 `provider_type` 字段**，需新增（pi-ai 需要：`anthropic-messages` / `openai-completions` 等）
- 连接测试逻辑完全复用
- 备份/恢复逻辑完全复用
- 导入/导出逻辑完全复用

### 2.2 提示词管理 ✅ 高复用

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `prompt_manager.py` | 300 | **逻辑完全可复用** | `services/prompt_service.rs` |

**迁移要点**：
- 存储层从 JSON → SQLite，业务逻辑不变
- **实际 prompts.json 中有 8 个提示词**（非 11 个），3 个为内置系统提示词
- **实际代码不自动生成默认提示词**：`ensure_default_prompts()` 已是空操作（noop），`load_prompts()` 首次启动生成空结构
- **实际代码无 `category` 字段**，迁移时可按需新增
- 提示词内容会被 pi-agent 的 `save_prompt` 工具调用写入

** prompts.json 实际内容（8 个）**：
| id | name | 用途 |
|----|------|------|
| `prompt_generation_system` | 提示词生成 | 系统提示词，用于生成结构化提示词 |
| `generated_5adc96ef` | 主题词提取 | 历史档案主题词提取 |
| `d79bd458` | 提示词生成优化版 | 优化版提示词生成 |
| `formula_generation_system` | Excel公式生成 | 系统提示词，用于生成 Excel 公式 |
| `generated_197f59d2` | 题名中提取人名信息 | 历史题名中的人名提取 |
| *(python代码修复等)* | ... | 共 8 条（含不完整条目） |

### 2.3 Excel 处理 ✅ 中等复用

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `excel_processor.py` | 306 | **业务逻辑可复用** | `services/excel_service.rs` |
| `excel_utils.py` | 151 | **工具函数可复用** | `services/excel_service.rs` |
| `excel_formula_reader.py` | ~722 | **核心算法可复用** | `services/excel_service.rs` |
| `multi_excel_utils.py` | ~596 | **多文件逻辑可复用** | 内联于 `excel_service.rs` |

**迁移要点**：
- 读取：`openpyxl` → `calamine`（API 差异大，逻辑需重写）
- 写入：`openpyxl` → `rust_xlsxwriter`（API 差异大，逻辑需重写）
- **但业务逻辑**（列数据提取、"|||" 拼接、断点续传检测、增量保存）完全可移植
- 公式单元格保护算法（`excel_formula_reader.py`）需移植到 Rust
- Markdown 预览生成移至前端 TypeScript 实现
- `multi_excel_utils.py` 提供多文件/多Sheet管理逻辑

** `formula_config.json` 实际存在**（135 行），包含：
- 公式处理默认设置（preview_rows=10, batch_size=1000, 错误策略）
- 10 个预置公式模板（SUM, AVERAGE, SUMIF, COUNTIF, MAX, MIN, IF, CONCATENATE, SUBSTITUTE, TODAY）
- 错误处理策略（skip/default/stop/retry）
- 写入覆盖策略（overwrite/append/new_sheet）
- 性能配置（batch sizes, memory limits, timeouts）

### 2.4 公式引擎 ✅ 高复用

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `formula_engine.py` | 244 | **算法完全可复用** | `services/excel_service.rs` |
| `formula_generator.py` | 207 | **缓存/历史逻辑可复用** | 部分：缓存移至 SQLite formula_cache 表 |
| `formula_processor.py` | 559 | **批量应用逻辑可复用** | `services/excel_service.rs` |

**迁移要点**：
- `FormulaRowAdjuster` 的 regex 模式（cell_pattern, range_pattern, string_pattern, adjust_formula_for_row）完全移植到 Rust
- 公式生成不再由 Rust 调用 LLM，而是 pi-agent 对话生成后调用 `apply_formula` 工具
- 公式缓存：Python `dict` → SQLite `formula_cache` 表
- 批量公式应用逻辑移植到 Rust（`apply_formula` 工具的后端实现）
- `formula_processor.ProgressInfo` 数据结构可直接映射到 Tauri Events
- 暂停/继续/停止状态管理移植到 Rust BatchService

### 2.5 数据验证与工具 ✅ 高复用

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `data_validator.py` | 241 | **逻辑完全可复用** | `services/config_service.rs` |
| `column_utils.py` | 121 | **逻辑可参考** | 内联于 `excel_service.rs` + 前端 TypeScript |

**迁移要点**：
- `DataValidator` 的 regex 规则移植到 Rust（API Key 格式、URL 格式、模型名称验证）
- `ColumnUtils` 的列名解析（A列-列名格式）移植到 Rust
- Markdown 预览生成移至前端 TypeScript 实现

### 2.6 批处理器 🟡 逻辑复用，实现重写

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `llm_batch_processor.py` | 446 | **业务逻辑可复用** | `src-agent/batch/runner.ts` |
| `prompt_generator.py` | 489 | **不再需要** | pi-agent 对话替代 |

`llm_batch_processor.py` 核心复用点：
- `ProcessingState` 状态管理（total/processed/success/failed）→ `BatchStatus` Rust 类型
- 行逐行处理 + 断点续传跳过逻辑
- 暂停/继续/停止状态机
- 进度回调模式 → stdout JSONL 事件
- 每行保存逻辑

```python
class ProcessingState:
    def __init__(self):
        self.total = 0; self.processed = 0; self.success = 0; self.failed = 0
        self.start_time = None; self.current_speed = 0.0
```

`prompt_generator.py` 不复用原因：
- 该模块用于 UI 结构化表单生成提示词，新版改为 pi-agent 多轮对话生成
- 但其中的 `PromptStructureProcessor.build_structured_prompt()` 的字段拼接逻辑可作为 pi-agent 系统提示词模板参考

### 2.7 任务调度 🟡 逻辑参考

| 文件 | 实际行数 | 复用情况 | 迁移目标 |
|------|---------|---------|---------|
| `task_scheduler.py` | 302 | **异步任务逻辑可参考** | Rust `tokio` 异步运行时 |

`task_scheduler.py` 核心复用点：
- 任务优先级/状态管理（PENDING/RUNNING/COMPLETED/FAILED）
- 超时管理和结果持久化

---
<!-- PLACEHOLDER_SECTION_3 -->

## 三、不复用的模块与替代方案

| 旧模块 | 实际行数 | 替代方案 | 替代原因 |
|--------|---------|---------|---------|
| `units/llm_client.py` | ~422 | pi-agent + pi-ai Provider 内置 | 内置重试、流式、多 Provider |
| `modules/python_code_processor.py` | 906 | pi-agent bash 工具 + Agent Loop | 自动生成/执行/修复，无需自研编排 |
| `modules/python_code_executor.py` | ~498 | pi-agent bash 工具 | 直接执行 Python，无需自研执行器 |
| `modules/package_manager.py` | ~420 | Agent 自主 `pip install` | Agent 判断依赖并安装 |
| `modules/prompt_generator.py` | 489 | pi-agent 对话 | 提示词通过多轮对话生成，无需结构化表单 |
| **合计** | **~2735** | **0 行代码** | **全部由 pi-agent 替代** |

**节省的工作量**：原方案中这些模块的迁移约需 15 人天，现在为 0。

---
<!-- PLACEHOLDER_SECTION_4 -->

## 四、配置数据模型迁移核查

| 现有文件 | 实际内容 | 迁移目标 | 变更 |
|---------|---------|---------|------|
| `models_config.json` | 6 个模型，无 provider_type | SQLite `models` 表 + tauri-plugin-store | **新增 `provider_type` 字段** |
| `models_config.example.json` | 配置示例结构 | 保留参考 | 无 |
| `prompts.json` | **实际 8 个提示词**（非 11 个） | SQLite `prompts` 表 | 可按需新增 `category` 字段 |
| `formula_config.json` | 公式模板、错误策略、覆盖策略 | SQLite `settings` 表 | 部分简化（批量阈值移至前端） |

**重要澄清**：
- 代码中不存在 `conversations` 和 `conversation_messages` 表 — 对话由 pi-agent SessionManager（JSONL）管理
- `models_config.json` 中 `api_key` 为明文，需加密迁移到 tauri-plugin-store
- `formula_config.json` 中的 10 个预置公式模板可参考迁移到 SQLite `settings` 或作为内置常量

---
<!-- PLACEHOLDER_SECTION_5 -->

## 五、项目文件规模统计（实际核查）

| 目录 | 文件数 | 实际大小 | 说明 |
|------|--------|---------|------|
| `modules/` | 15 | ~130KB | 核心业务逻辑 |
| `ui/` | 11 | ~190KB | Tkinter UI 层 |
| `units/` | 1 | ~16KB | LLM 客户端 |
| `main.py` | 1 | ~13KB | 主控制器 |
| `config/` | 4 | ~45KB | 配置文件（含 prompts.json 43KB） |
| **source_code/** | **19 files** | **~384KB** | 已复制到 `ai-sheet-v2-reusable-code/` |
| **总计** | **~33** | **~394KB** | Python 源码 |

---
<!-- PLACEHOLDER_SECTION_6 -->

## 六、复用到新架构的映射关系

### 6.1 复用到 Rust 后端

```
原项目文件                                      → 新项目 Rust 文件
-------------------------------------------------------------------------------
modules/config_manager.py                      → src-tauri/src/services/config_service.rs
modules/prompt_manager.py                      → src-tauri/src/services/prompt_service.rs
modules/excel_processor.py                     → src-tauri/src/services/excel_service.rs
modules/excel_utils.py                         → src-tauri/src/services/excel_service.rs
modules/excel_formula_reader.py                → src-tauri/src/services/excel_service.rs
modules/formula_engine.py                      → src-tauri/src/services/excel_service.rs
modules/formula_processor.py                   → src-tauri/src/services/excel_service.rs
modules/multi_excel_utils.py                   → src-tauri/src/services/excel_service.rs
modules/data_validator.py                      → src-tauri/src/services/config_service.rs
modules/column_utils.py                        → src-tauri/src/services/excel_service.rs
config/models_config.json                      → SQLite models 表 + tauri-plugin-store
config/prompts.json                            → SQLite prompts 表（8 条，非 11）
config/formula_config.json                     → SQLite settings 表（含公式模板）
```

### 6.2 复用到 Node.js Sidecar

```
原项目文件                                      → 新项目 Node.js 文件
-------------------------------------------------------------------------------
modules/llm_batch_processor.py                 → src-agent/src/batch/runner.ts
modules/prompt_manager.py (提示词内容)          → src-agent/src/prompts/system.ts
config/prompts.json（系统提示词部分）            → src-agent/src/prompts/system.ts
```

### 6.3 不复用（pi-agent 替代）

```
原项目文件                                      → 替代方案
-------------------------------------------------------------------------------
units/llm_client.py                            → pi-agent + pi-ai Provider（内置）
modules/python_code_processor.py               → pi-agent bash 工具 + Agent Loop
modules/python_code_executor.py                → pi-agent bash 工具
modules/package_manager.py                     → Agent 自主 pip install
modules/prompt_generator.py                    → pi-agent 多轮对话
modules/task_scheduler.py                      → Rust tokio 异步运行时
```

---
<!-- PLACEHOLDER_SECTION_7 -->

## 七、复用文件索引（source_code/ 目录）

已复制至 `ai-sheet-v2-reusable-code/source_code/` 的文件清单：

```
source_code/
├── config/
│   ├── models_config.json         # 6 个模型配置（需加 provider_type 字段）
│   ├── models_config.example.json # 配置示例结构
│   ├── prompts.json               # 8 个提示词（需补充/整理）
│   └── formula_config.json        # 公式模板与处理设置
├── modules/
│   ├── config_manager.py          # 多模型配置 CRUD + 验证 + 备份恢复（484行）
│   ├── prompt_manager.py          # 提示词管理 CRUD（300行）
│   ├── excel_processor.py         # Excel 读写 + 批量处理（306行）
│   ├── excel_utils.py             # Excel 工具函数 + Markdown 预览（151行）
│   ├── excel_formula_reader.py    # Excel 公式读取 + 保护算法（~722行）
│   ├── multi_excel_utils.py       # 多 Excel 多 Sheet 管理（~596行）
│   ├── formula_engine.py          # 公式行号调整器（244行）
│   ├── formula_generator.py       # 公式缓存 + 历史 + 生成入口（207行）
│   ├── formula_processor.py       # 公式批量处理 + 状态管理（559行）
│   ├── llm_batch_processor.py     # LLM 批量处理核心（446行）
│   ├── data_validator.py          # 数据验证工具（241行）
│   ├── column_utils.py            # 列选择 + Markdown 预览工具（121行）
│   └── task_scheduler.py          # 异步任务调度（302行）
├── units/
│   └── llm_client.py              # LLM 客户端（参考，新版为 pi-agent 替代）
└── main.py                        # Tkinter 主入口（架构参考）
```

---
<!-- PLACEHOLDER_SECTION_8 -->

## 八、工作任务估测更新

| 阶段 | Rust | Node.js/pi-agent | 前端 | 总计 |
|------|------|-----------------|------|------|
| Phase 0 初始化 | 1.5 | 1 | 2 | 4.5 |
| Phase 1 基础设施 | 4 | 3 | 4 | 11 |
| Phase 2 Excel 核心 | 4 | 2 | 4 | 10 |
| Phase 3 Agent 能力 | 1 | 5 | 4 | 10 |
| Phase 4 批量处理 | 1 | 3 | 2 | 6 |
| Phase 5 打磨发布 | 2 | 1 | 3 | 6 |
| **总计** | **13.5** | **15** | **19** | **47.5** |

**与旧差距分析对比**：从 58-70 天 → 47.5 天，减少 30-40%。

---
<!-- PLACEHOLDER_SECTION_9 -->

## 九、关键风险与数据迁移注意事项

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| pi-agent API 不稳定 | 中 | 高 | 锁定版本；预留降级到自研 LLM 客户端的接口 |
| Node.js Sidecar 打包体积 | 中 | 中 | Bun compile 或 pkg 单文件打包 |
| calamine/rust_xlsxwriter 兼容性 | 中 | 中 | 提前用现有 Excel 文件验证 |
| prompts.json 条目不足 | 低 | 低 | 实际 8 条，新系统可补充至需求数量 |
| API Key 明文迁移 | 低 | 高 | 迁移时自动加密存 tauri-plugin-store |
| 公式_config.json 新字段 | 低 | 中 | 迁移脚本自动映射到 SQLite settings |
| HTTP Bridge 安全风险 | 低 | 高 | 仅 localhost + 动态端口 + 请求验证 |
| 三栏布局小屏适配 | 中 | 低 | 右栏可折叠 |

---
<!-- PLACEHOLDER_SECTION_10 -->

## 十、数据迁移脚本设计

```python
# tools/migrate_config.py
def migrate_models(json_path, sqlite_path):
    """迁移模型配置 JSON → SQLite（新增 provider_type 字段）"""
    pass

def migrate_prompts(json_path, sqlite_path):
    """迁移提示词 JSON → SQLite（可选新增 category 字段）"""
    pass

def migrate_formula_config(json_path, sqlite_path):
    """迁移公式配置 JSON → SQLite settings 表"""
    pass

def migrate_encrypt_keys(models_json_path, keystore_path):
    """迁移 API Key：从明文 models_config.json → tauri-plugin-store 加密存储"""
    pass
```

---
<!-- PLACEHOLDER_SECTION_11 -->

## 十一、验证步骤

1. **配置迁移验证**：所有模型配置（6条）、提示词（8条）、公式配置正确迁移到 SQLite
2. **API Key 加密验证**：迁移后明文 API Key 从 models_config.json 删除，仅存储于 tauri-plugin-store
3. **Excel 读取验证**：calamine 能读取所有现有 Excel 文件（含多 Sheet）
4. **pi-agent 连接验证**：所有模型的 API 连接正常（通过 pi-ai Provider）
5. **公式引擎验证**：行号调整算法与现有输出一致（含绝对引用、范围引用保护）
6. **批量处理验证**：100 行 Excel 批量 LLM 调用结果与原项目一致
7. **Python 执行验证**：Agent 通过 bash 工具执行 Python 处理 Excel
