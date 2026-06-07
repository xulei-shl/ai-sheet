# 上下文预览功能实现计划

## ✅ 已完成

### 1. 类型定义更新
- ✅ 更新 `src/types/agent.ts`：
  - 添加 `LoadedFile` 接口（包含 name, path, sheet）
  - 添加 `SampleDataPreview` 接口（包含 columns, rows）
  - 更新 `AgentContext` 接口以使用这些新类型

### 2. Store 层更新
- ✅ 更新 `agentStore.ts`：
  - 添加 `loadedContext: AgentContext | null` 状态
  - 添加 `setLoadedContext(context)` 方法

- ✅ 更新 `excelStore.ts`：
  - 在所有数据变更点（`addFile`, `removeFile`, `selectSheets`, `selectColumns`, `loadPreview`）调用 `notifyContextChange()`
  - 更新 `notifyContextChange()` 方法：
    - 构建丰富的前端上下文（包含文件、列、预览数据）
    - 调用 `useAgentStore.getState().setLoadedContext(richContext)` 更新前端状态
    - 发送简化的上下文到后端（通过 `steerAgent`）

### 3. UI 组件实现
- ✅ 创建 `src/components/agent/ContextPreview.tsx`：
  - 显示已加载文件列表（带文件图标和 sheet 名称）
  - 显示选中的列（标签形式）
  - 显示数据预览表格（前 3 行）
  - 可折叠/展开的设计
  - 使用设计系统的颜色和样式

- ✅ 更新 `MessageList.tsx`：
  - 从 `agentStore` 读取 `loadedContext`
  - 在消息列表顶部渲染 `<ContextPreview />` 组件
  - 在空状态时也显示上下文预览

### 4. 构建验证
- ✅ TypeScript 类型检查通过
- ✅ Vite 构建成功（496.83 kB，gzip: 143.41 kB）

## 实现细节

### 数据流
```
用户操作（上传文件/选择列）
  ↓
excelStore 更新状态
  ↓
notifyContextChange()
  ↓
├─→ 构建 richContext（前端用）
│   └─→ setLoadedContext(richContext)
│       └─→ agentStore.loadedContext 更新
│           └─→ ContextPreview 重新渲染
│
└─→ 构建 backendContext（后端用）
    └─→ steerAgent(backendContext)
        └─→ Rust → Node.js Agent
```

### UI 特性
- **文件显示**：图标 + 文件名 + Sheet 名称
- **列显示**：标签形式，紧凑排列
- **数据预览**：表格形式，最多显示 3 行，超过时显示"还有 N 行数据..."
- **折叠控制**：默认折叠，点击展开查看详情
- **无数据处理**：如果没有加载任何内容，整个组件不显示

### 样式规范
- 遵循设计系统的颜色变量（`--primary`, `--surface`, `--border`, `--ink`, `--muted`）
- 使用 lucide-react 图标（`FileSpreadsheet`, `Layers`, `ChevronDown`, `ChevronUp`）
- 响应式设计，表格单元格最大宽度 120px，超出时截断并显示 title

## 后续改进建议

1. **性能优化**：
   - 如果文件/列数量很大，考虑虚拟滚动
   - 数据预览可以添加分页或懒加载

2. **用户体验**：
   - 添加"复制上下文"按钮，方便用户分享
   - 支持从上下文预览中快速跳转到数据页面
   - 添加刷新按钮手动同步上下文

3. **国际化**：
   - 所有文本内容提取到 i18n 文件
   - 支持中英文切换

4. **测试**：
   - 添加单元测试验证 context 构建逻辑
   - 添加 E2E 测试验证完整交互流程

## 验证步骤

1. 启动应用：`npm run tauri dev`
2. 上传一个 Excel 文件
3. 选择一个 Sheet
4. 选择若干列
5. 打开右侧 Agent 面板
6. 验证上下文预览卡片显示：
   - ✓ 文件名和 Sheet 名称
   - ✓ 选中的列
   - ✓ 前 3 行数据预览
   - ✓ 可以折叠/展开
