# Product

## Register

product

## Users
需要智能化处理复杂表格数据的高级用户，包括数据分析师、工程师及相关领域的专业人士。他们通常是在桌面办公环境中使用该软件，为了高效完成诸如批量文本处理、公式应用、数据清洗等工作。

## Product Purpose
将先进的 LLM (pi-agent) 与 Excel 处理能力深度结合，作为用户的专业辅助大脑。提供极低延迟的桌面端体验，替代过去繁琐或受限的网页/云端方案，使得复杂的批量数据任务能够被一键或通过自然语言对话解决。成功的标志是用户能感受到类似“现代开发者工具”般的极致效率与可靠性。

## Brand Personality
专业 (Professional)、克制 (Restrained)、高阶 (Premium)。
界面整体呈现现代工程师的高级工具质感。

## Anti-references
- **臃肿的顶部菜单**：不要传统 Office 复杂的 Ribbon 菜单栏。
- **过度拟物与廉价的“游戏感”**：拒绝大面积渐变色、厚重投影或 3D 浮雕按钮。所有组件走扁平化（Flat）或微质感（Glassmorphism）路线。
- **喧宾夺主的 AI 形象**：不需要拟人化的虚拟形象或夸张的聊天气泡，AI 消息流应类似终端（Terminal）日志与现代文档的结合体。
- **高饱和度刺眼色彩**：避免大红大绿表示状态，改用柔和的粉红/柔绿，搭配极简图标。

## Design Principles
- **极致聚焦**：黑白灰无彩色系构建基础框架，低饱和度品牌色仅用于 AI 交互及核心状态高亮。
- **空间呼吸与无感边界**：用 1px 极细边框或透明度边框划分三栏布局，弱化视觉噪音（如表格线），实现极高的数据信噪比 (Data-to-Ink Ratio)。
- **优雅的微交互**：AI 输出带有平滑淡入，工具调用采用呼吸灯效果的折叠卡片，按钮 Hover 提供细腻的模糊发光或背景色过渡。
- **自下而上的高级感**：支持流畅的暗色模式、全键盘无障碍操作，并在缩放时拥有克制且优雅的响应式降级策略。

## Accessibility & Inclusion
- **视觉对比度**：无论亮/暗色主题，文本与背景对比度需严格达到 WCAG AA 级标准。
- **全键盘可访问**：Tab 键切换焦点、Enter 确认、Esc 退出等交互必须顺滑，Focus Ring 清晰优雅。
- **优雅的自适应**：缩放时具有合理的响应式策略（左侧 Tab 缩为图标，右侧 AI 栏变更为悬浮抽屉）。

---

## Non-Functional Requirements (审查报告补充)

### Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Cold Start | <2s | 桌面应用应感觉即开即用 |
| Excel Load (1000 rows) | <500ms | Rust calamine 高性能读取 |
| AI First Token | <1s | 网络瓶颈，最小化感知延迟 |
| UI Frame Rate | 60fps | 流畅动画和滚动体验 |
| Memory Footprint | <200MB | Rust (~20MB) + Node.js (~60MB) + WebView (~100MB) |
| Batch Processing | 10-15 行/分钟 | LLM API 为瓶颈，非应用性能问题 |

### Accessibility (WCAG AA 合规)

**Color Contrast 色彩对比度**:
- 所有文本满足 WCAG AA 对比度要求（正常文本 4.5:1，大文本 3:1）
- 纯灰度无彩色基础确保跨模式无障碍访问
- 主色调 (`--primary`) 对白色背景对比度 >4.5:1

**Keyboard Navigation 键盘导航**:
- 完整键盘支持：Tab, Shift+Tab, Enter, Escape, 方向键
- 所有交互元素无需鼠标即可访问
- 清晰的焦点指示器（2px 主色描边，2px 偏移）
- 键盘快捷键：
  - `Ctrl+K` (macOS: `⌘K`) - 聚焦 AI 输入框
  - `Ctrl+,` (macOS: `⌘,`) - 打开设置
  - `Ctrl+O` (macOS: `⌘O`) - 打开文件
  - `Ctrl+/` (macOS: `⌘/`) - 快捷键帮助
  - `Escape` - 关闭模态框/停止流式输出/折叠面板

**Screen Reader Support 屏幕阅读器支持**:
- 语义化 HTML（`<nav>`, `<main>`, `<aside>`, `<article>`）
- 所有图标按钮包含 `aria-label`
- 动态内容使用 `aria-live` 区域（流式 AI、批量进度）
- 错误通知使用 `role="alert"` 和 `aria-live="assertive"`
- 表格数据使用 `<table>` + `<th scope="col">` 语义标记

**Motion Sensitivity 动效敏感性**:
- 遵守 `prefers-reduced-motion` 系统偏好
- 前庭障碍用户可通过系统设置禁用所有动画
- 关键功能不依赖动画（纯装饰性）

**示例实现**:

```tsx
// 图标按钮无障碍
<button 
  aria-label="折叠 AI 面板" 
  className="..."
>
  <ChevronRight aria-hidden="true" />
</button>

// 动态内容播报
<div 
  role="status" 
  aria-live="polite" 
  aria-atomic="true"
>
  已完成 {current}/{total} 行
</div>

// 错误警告
<div 
  role="alert" 
  aria-live="assertive"
>
  API 调用失败，请重试
</div>
```

### Responsive Design 响应式设计

**支持的屏幕尺寸**:

| 尺寸分类 | 最小宽度 | 布局策略 | 用户体验 |
|---------|---------|---------|---------|
| 小型笔记本 | 1024px | 双栏（右栏折叠） | 核心功能可用，显示警告 |
| 标准桌面 | **1280px** | **完整三栏（最佳）** | 设计目标体验 |
| 大屏桌面 | 1920px+ | 三栏 + 更宽松间距 | 增强舒适度 |

**自适应行为**:

| 断点 | 行为 |
|------|------|
| < 1024px | ⚠️ 显示"建议使用更大屏幕"横幅警告 |
| < 1280px | 右侧 AI 面板自动折叠为浮动抽屉（带切换按钮） |
| ≥ 1280px | 完整三栏：左导航 64px + 中栏弹性宽度 + 右 AI 面板 384px |
| ≥ 1920px | 增加内边距（padding），提升视觉呼吸感 |

**布局灵活性**:
- 右侧面板可通过按钮手动折叠/展开（保存用户偏好到 localStorage）
- 中栏使用 `flex-1` 自适应可用空间
- 左侧导航在窄视口缩为纯图标模式（隐藏文本标签）
- 所有模态框在小屏下全屏显示

**小屏警告实现**:

```tsx
{window.innerWidth < 1024 && (
  <Alert className="m-4 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/30">
    <Monitor className="h-5 w-5 text-amber-600 dark:text-amber-400" />
    <AlertTitle>建议使用更大的屏幕</AlertTitle>
    <AlertDescription>
      为获得最佳体验，建议使用至少 <strong>1280px</strong> 宽度的屏幕。
      当前部分功能可能显示不完整或折叠。
    </AlertDescription>
  </Alert>
)}
```

### Internationalization (i18n) - 未来扩展

**当前状态**: 仅中文（简体中文）  
**规划支持**: English, 繁體中文

**准备工作**:
- 所有 UI 字符串外部化到翻译文件 (`src/locales/zh-CN.json`, `en-US.json`)
- 使用 `i18next` 或 `react-intl` 进行运行时语言切换
- 数字/日期格式本地化（使用 `Intl.NumberFormat`, `Intl.DateTimeFormat`）
- 避免硬编码文本宽度（改用 `max-content` 或 `fit-content`）

### Security 安全性

**API Key 存储**:
- 使用操作系统级加密存储：
  - Windows: Credential Manager (DPAPI)
  - macOS: Keychain Access
- SQLite 数据库中 API Key 字段二次加密（AES-256-GCM）
- 永不记录到日志或发送到分析服务

**网络安全**:
- 所有外部 API 调用强制 HTTPS
- HTTP Bridge 严格限制为 `localhost` + 动态端口分配
- 无遥测或"电话回家"功能（除非用户明确同意）

**代码执行沙箱**:
- Python 代码通过 pi-agent `bash` 工具执行（隔离进程）
- 前端无 `eval()` 或任意代码注入
- Tauri 安全模型：前端无 Node.js 访问，仅通过 IPC 调用 Rust

**依赖供应链**:
- 锁定依赖版本（`package-lock.json`, `Cargo.lock`）
- 定期扫描漏洞（`npm audit`, `cargo audit`）
- Sidecar 打包为单文件可执行（减少攻击面）

---

## Success Metrics 成功指标

### Technical Health 技术健康度

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 崩溃率 | <0.1% | Sentry 错误追踪 |
| API 成功率 | >99%（含降级） | 每次请求记录 |
| Sidecar 在线时间 | >99.9% | 心跳监控 |
| 数据丢失事件 | 0 | Checkpoint 恢复验证 |

### User Experience 用户体验

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 首次批量处理时间 | <3分钟 | 从安装到首次 LLM 批量 |
| 空状态 CTA 点击率 | >60% | 用户从空状态点击引导按钮 |
| 错误恢复成功率 | >90% | API 失败后成功重试的比例 |
| 降级 API 激活率 | <5% | 使用默认 API 的频率 |

### Quality Assurance 质量保证

**发布前检查清单**:

**P0 验证项**（必须全部通过）:
- [ ] V-API-1: 默认配置可用（删除用户配置仍可调用 DeepSeek-V3）
- [ ] V-API-2: 降级通知（用户配置失败显示 Toast）
- [ ] V-COM-1: Sidecar 自动重启（杀死进程后 15 秒内恢复）
- [ ] V-COM-2: HTTP 超时（30 秒超时正确抛出错误）
- [ ] V-UI-1: 加载骨架屏（Excel 加载显示 TableSkeleton）
- [ ] V-UI-2: 错误提示（API 失败显示带重试按钮的 Alert）
- [ ] V-UI-3: 空状态引导（无数据显示 EmptyState 带 CTA）
- [ ] V-UI-4: 响应式折叠（窗口 <1280px 右栏自动折叠）
- [ ] V-MIG-1: 自动迁移（放置旧配置自动迁移并备份）
- [ ] V-MIG-2: Provider 推断（所有模型 provider_type 正确）
- [ ] V-MIG-3: API Key 加密（迁移后 SQLite 密钥已加密）
- [ ] V-BAT-1: 批量暂停（处理中暂停，当前行完成后停止）
- [ ] V-BAT-2: 断点续传（暂停后关闭应用，重启从断点继续）
- [ ] V-BAT-3: 网络重试（网络故障自动重试 3 次指数退避）

**无障碍验证**:
- [ ] WCAG AA 对比度验证（使用 axe DevTools 扫描）
- [ ] 键盘导航测试（全程无鼠标操作）
- [ ] 屏幕阅读器测试（Windows NVDA + macOS VoiceOver）
- [ ] 响应式测试（1024px, 1280px, 1920px 三档）

**压力测试**:
- [ ] 10,000 行批量处理（验证内存不泄漏、Checkpoint 正常）
- [ ] 网络故障模拟（断网、超时、5xx 错误恢复）
- [ ] 长时间运行（24 小时无崩溃、Sidecar 无僵死）

---

**文档版本**: v2.1（全面增强）  
**更新日期**: 2026-06-05  
**审查依据**: [tasks/review-report.md](../tasks/review-report.md)
