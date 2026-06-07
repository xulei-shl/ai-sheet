# AI-Sheet Implementation TODO

## Phase 0 - Bootstrap (已完成)

- [x] Vite + React + Tauri scaffolding
- [x] Tailwind CSS 4, Ant Design 5, Zustand 5
- [x] TypeScript and Rust checks pass

## Phase 1 - App Shell (已完成)

- [x] Three-column layout with resizable sidebars
- [x] Empty / Loading / Error UI states
- [x] Tab navigation (data, formula, AI, config, prompts)
- [x] AgentChatPanel with message list + streaming

## Phase 2 - Rust Backend (已完成)

- [x] Excel read service (calamine): get_info, get_column_names, get_sample_data, get_column_data, get_processing_status
- [x] Excel write service (rust_xlsxwriter): write_results, apply_formula
- [x] HTTP Bridge Server (localhost dynamic port, 6+ API endpoints)
- [x] Sidecar Manager (process lifecycle, heartbeat, steer/stop_stream)
- [x] Config Service (built-in DeepSeek-V3 + GLM-4-Flash fallback)
- [x] 16 Tauri IPC commands registered
- [x] Custom AppError with rust_xlsxwriter::XlsxError conversion

## Phase 3 - pi-agent Integration (已完成)

- [x] Node.js Sidecar with AgentSession
- [x] Custom tools: read_excel, write_excel, apply_formula, get_config, save_prompt, start_batch
- [x] BatchRunner with checkpoint/pause/resume/retry
- [x] JSONL protocol + full event types
- [x] System prompt with dynamic context injection

## Phase 4 - Frontend (已完成)

- [x] DataPage: file upload → sheet selection → column selection → preview
- [x] FormulaPage: file/sheet/column selectors + formula input + preview + apply
- [x] AiPage with sub-navigation: 提示词生成 / LLM 批量处理 / Python 处理
- [x] LLMProcessingPage: full batch processing UI with progress bar, logs, pause/resume/stop
- [x] PythonProcessingPage: script editor + execution + output display
- [x] ConfigPage: model CRUD (add/edit/delete) + test connection
- [x] PromptsPage: prompt CRUD (add/edit/delete) + search

## Phase 5 - State Management (已完成)

- [x] excelStore: multi-file/sheet/column selection + preview + context injection
- [x] agentStore: message state + streaming + event handling
- [x] processingStore: batch progress + logs + real event subscription
- [x] uiStore: tab navigation + sidebar collapse/resize
- [x] configStore: model config CRUD + localStorage persistence → **已迁移到 SQLite**
- [x] promptStore: prompt CRUD + search + localStorage persistence → **已迁移到 SQLite**

## Phase 6 - SQLite Database (已完成)

- [x] rusqlite with bundled feature
- [x] Database module (db/) with WAL mode, connection management
- [x] Schema migration: models, prompts, formula_cache, settings tables
- [x] models_repo: user model CRUD
- [x] prompts_repo: prompt CRUD
- [x] formula_cache_repo: formula history CRUD
- [x] Bridge Server updated to use SQLite for prompt operations
- [x] Tauri commands: get_user_models, add/update/delete_user_model
- [x] Tauri commands: get_all_prompts, save/update/delete_prompt
- [x] Frontend stores migrated from localStorage to Tauri IPC (SQLite)

## Phase 7 - Features (已完成)

- [x] Formula history cache: auto-save applied formulas, history dropdown in FormulaPage
- [x] ErrorBoundary global error boundary component
- [x] Responsive layout: auto-collapse right sidebar < 1280px, < 1024px warning banner
- [x] Keyboard shortcuts: Ctrl+K (focus AI input), Ctrl+B (toggle left sidebar), Ctrl+\\ (toggle right sidebar), Escape (close right sidebar)

## Phase 8 - Tauri Plugins Integration (已完成)

- [x] tauri-plugin-dialog: native file open dialog (replaced HTML input in DataPage)
- [x] tauri-plugin-fs: filesystem permission configuration
- [x] tauri-plugin-store: API key encrypted storage (separated from SQLite)
- [x] tauri-plugin-updater: auto-update configuration with endpoints
- [x] Updated tauri.conf.json with plugin configs
- [x] Updated capabilities/default.json with plugin permissions

## Phase 9 - Unit Tests (已完成)

- [x] config_service: 4 tests (active model, fallback chain, model data, to_model_config)
- [x] excel_service: 11 tests (get_info, columns, sample data, column data, write, formula, status, error cases)
- [x] db/models_repo: 7 tests (CRUD, multiple, empty, index)
- [x] db/prompts_repo: 4 tests (CRUD, multiple)
- [x] db/formula_cache_repo: 4 tests (insert, get all, touch, empty)

## 待办 (Future)

## Phase 10 - 主题系统升级：双模式支持 (已完成)

- [x] Wilderness / WoodAsh 双色板（B3 语义层 + Legacy 简写层）
  - `[data-theme-mode="dark"]` / `[data-theme-mode="light"]` 两套独立 token 块
  - Legacy token（`--bg` / `--surface` / `--primary` 等）通过 `var(--b3-theme-*)` 别名复用
- [x] `uiStore.themeMode` + localStorage 持久化
- [x] `useTheme()` 钩子：解析 `system` 模式 + 监听 `prefers-color-scheme` 变化
- [x] 标题栏 `ThemeToggle` 三态循环按钮（系统 ↔ 浅色 ↔ 深色）
- [x] `index.html` 预挂载脚本：避免 React 挂载前主题闪烁
- [x] 硬编码颜色清理（`#16a34a` → `var(--success)`）
- [x] `prefers-reduced-motion` 下禁用 `body` 颜色过渡

## 待办 (Future)

- [ ] End-to-end batch processing test with real pi-agent
- [ ] Cross-file formula references design and implementation

## 验证记录

- `npm run typecheck` — passed (0 errors)
- `npm run build` — passed (488 kB JS, 41.8 kB CSS)
- `cargo check` — passed (0 errors, 0 warnings)
- `cargo test` — 28 passed (0 failed)
