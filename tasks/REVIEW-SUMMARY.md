# AI-Sheet 升级方案评审总结

> **评审结论**: 方案基础扎实，但存在5个关键缺失需要补充

---

## 一、核心发现

### ✅ 设计优秀的部分

1. **三进程架构** - 职责清晰，性能与灵活性兼顾
2. **pi-agent集成** - 节省12人天开发量，消除2735行自研代码
3. **双模式交互** - 直接执行+Agent辅助，满足不同用户场景
4. **技术选型** - Rust/Tauri/React/pi-agent均为成熟可靠的技术栈

### ❌ 关键缺失（必须补充）

| 编号 | 问题 | 严重度 | 影响 |
|------|------|--------|------|
| 1 | **API配置方案缺失** | 🔴 严重 | 用户核心需求未实现 |
| 2 | **跨进程通信脆弱** | 🔴 严重 | 稳定性风险高 |
| 3 | **UI交互状态不完整** | 🟡 中等 | 用户体验差 |
| 4 | **数据迁移方案缺失** | 🟡 中等 | 现有配置无法迁移 |
| 5 | **批量处理性能未验证** | 🟡 中等 | 1000+行处理可能超时 |

---

## 二、用户需求分析（API配置）

### 用户原始需求

> "代码里有个默认的配置。当没有在界面中新增配置时就用默认的。如果页面中选择新增大模型api，则优先用这个，但支持失败时自动降级到默认的api配置"

### 需求拆解

1. **内置默认配置** - 硬编码1-2个免费API（DeepSeek/GLM）
2. **优先级机制** - 用户配置 > 默认配置
3. **自动降级** - 用户API失败后自动切换
4. **失败恢复** - 所有API失败时的友好提示

### 推荐方案

```rust
// src-tauri/src/config/defaults.rs
pub const DEFAULT_MODELS: &[DefaultModelConfig] = &[
    DefaultModelConfig {
        name: "DeepSeek-V3 (内置默认)",
        provider_type: "openai-completions",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        api_key: "",  // DeepSeek支持无Key试用
        priority: 0,
    },
];

// 降级逻辑
impl LLMService {
    pub async fn call_with_fallback(&mut self, messages: Vec<Message>) -> Result<String> {
        // 1. 尝试用户配置
        if let Some(user_model) = self.get_current_user_model() {
            if let Ok(response) = self.call_model(&user_model, &messages).await {
                return Ok(response);
            }
            self.emit_toast("当前API不可用，已自动切换到默认配置");
        }

        // 2. 降级到默认配置
        for default in &self.default_models {
            if let Ok(response) = self.call_model(default, &messages).await {
                return Ok(response);
            }
        }

        Err(anyhow!("所有API配置均失败，请检查网络连接"))
    }
}
```

---

## 三、风险矩阵

| 风险 | 可能性 | 影响 | 严重度 | 缓解措施 |
|------|--------|------|--------|---------|
| API配置方案缺失 | 高 | 高 | 🔴 严重 | 立即补充设计（本周完成） |
| 跨进程通信不稳定 | 中 | 高 | 🔴 严重 | 加固通信机制（Phase 1） |
| pi-agent版本不稳定 | 中 | 高 | 🔴 严重 | 锁定版本+降级方案 |
| 批量处理性能差 | 中 | 中 | 🟡 中等 | 性能测试+优化（Phase 4） |
| UI状态设计不完整 | 低 | 中 | 🟡 中等 | 补充DESIGN-STATES.md |
| 数据迁移失败 | 低 | 高 | 🟡 中等 | 自动化迁移脚本 |

---

## 四、改进建议（优先级排序）

### P0 - 必须实现（阻塞开发）

1. ✅ **补充API配置设计**
   - 在upgrade-plan中新增章节
   - 实现内置默认配置 + 降级逻辑
   - 预计：1天

2. ✅ **加固跨进程通信**
   - 添加超时/重试/心跳机制
   - 实现断线恢复流程
   - 预计：2天

3. ✅ **补充UI状态设计**
   - 创建DESIGN-STATES.md
   - 设计加载/错误/空状态
   - 预计：1天

4. ✅ **数据迁移脚本**
   - provider_type自动推断
   - API Key加密迁移
   - 预计：2天

5. ✅ **批量处理优化**
   - 暂停/继续/断点续传
   - 每行立即保存
   - 预计：2天

### P1 - 强烈建议

- 响应式设计补充（右栏折叠、小屏适配）
- 性能基准测试（Excel读写、LLM批量调用）
- Sidecar健康检查（心跳、自动重启）
- 增量更新机制（避免全量刷新Excel）

### P2 - 可选优化

- Sidecar预热机制
- 大文件虚拟滚动
- 首次启动引导
- 工具调用日志系统

---

## 五、修订后的开发计划

| Phase | 原计划 | 新增任务 | 修订后 | 增量 |
|-------|--------|---------|--------|------|
| Phase 0 | 4.5天 | + 性能基准测试 | 5.5天 | +1天 |
| Phase 1 | 11天 | + 通信加固 + API配置 | 14天 | +3天 |
| Phase 2 | 10天 | + 迁移脚本 + 增量更新 | 12天 | +2天 |
| Phase 3 | 10天 | + UI状态设计 | 11天 | +1天 |
| Phase 4 | 6天 | + 批量处理优化 | 8天 | +2天 |
| Phase 5 | 6天 | + Sidecar监控 | 7天 | +1天 |
| **总计** | **47.5天** | | **57.5天** | **+10天** |

**关键路径变化：**
- Phase 1 工作量增加最多（+3天）
- 主要用于通信机制加固和API配置实现

---

## 六、立即行动计划

### 本周任务（开发前准备）

- [ ] **Day 1**: 补充API配置设计文档
  - 在upgrade-plan中新增"API配置与降级机制"章节
  - 设计降级逻辑伪代码
  - 确定默认API选择（DeepSeek推荐）

- [ ] **Day 2**: 补充UI状态设计文档
  - 创建DESIGN-STATES.md
  - 设计加载/错误/空状态
  - 设计响应式断点规则

- [ ] **Day 3**: 加固跨进程通信设计
  - 在multi-turn-conversation-design.md中补充
  - 设计超时/重试机制
  - 设计Sidecar健康检查协议

- [ ] **Day 4-5**: 编写数据迁移脚本
  - 实现provider_type自动推断
  - 实现API Key加密迁移
  - 编写测试用例

### 下周任务（Phase 0启动）

完成上述准备工作后，可以开始Phase 0实施。

---

## 七、结论

### 整体评价：方案基础扎实，需补充关键细节

**优点：**
- ✅ 架构设计合理，职责清晰
- ✅ pi-agent集成显著减少开发量
- ✅ 技术选型成熟可靠

**问题：**
- ❌ API配置方案完全缺失（用户核心需求）
- ❌ 跨进程通信容错能力不足
- ❌ UI交互状态设计不完整

### 建议

**不建议立即开始Phase 0**，建议先完成5个P0级别补充工作（预计6天）。

补充完成后，**可以放心开始实施**，预期工期57.5人天（比原计划增加10天）。

---

**文档**: [tasks/review-report.md](review-report.md)  
**版本**: v1.0  
**日期**: 2026-06-05
