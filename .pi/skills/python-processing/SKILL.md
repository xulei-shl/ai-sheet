---
name: python-processing
description: Python 数据处理工作流。使用 pandas + openpyxl 编写并执行 Python 脚本处理 Excel 数据，自动修复错误，直到成功。当用户需要用 Python 处理 Excel 数据时使用此技能。
---

# Python 数据处理

## 工作流程

1. **了解数据**：使用 `read_excel` 查看文件结构、Sheet 列表、列名和样本数据
2. **确认需求**：与用户多轮对话，明确处理目标和期望的输出格式
3. **编写脚本**：使用 `write` 工具创建 `.py` 文件，遵循下方模板和最佳实践
4. **执行脚本**：使用 `bash` 工具运行 `python <script>.py`
5. **检查结果**：
   - 若成功：展示输出，询问用户是否满意
   - 若出错：分析 stderr，修正脚本，回到步骤 4
6. **写入 Excel**：若需将结果写回 Excel，使用 `write_excel` 工具

## 脚本模板

```python
import pandas as pd
import sys

# 文件路径（从上下文获取或询问用户）
file_path = r"PATH_HERE"
sheet_name = "SHEET_HERE"

# 读取数据
df = pd.read_excel(file_path, sheet_name=sheet_name)
print(f"数据形状: {df.shape}")
print(f"列名: {list(df.columns)}")
print(df.head())

# === 在此添加数据处理逻辑 ===

# 输出结果
print(df.head(10))
print(f"处理后数据形状: {df.shape}")
```

## 最佳实践

- **始终先打印数据概况**：执行脚本后先确认数据读取正确
- **路径使用 raw string**：`r"C:\path\to\file.xlsx"` 避免转义问题
- **编码处理**：如遇编码问题，添加 `encoding='utf-8'` 或 `encoding='gbk'`
- **大文件分块**：超过 10MB 的文件建议分块读取 `chunksize=10000`
- **保存前备份**：写入 Excel 前确认用户意图，避免覆盖原始数据
- **使用 print 输出**：所有中间结果用 `print()` 输出，便于调试
- **格式异常处理**：读取 CSV 时添加 `on_bad_lines='skip'` 跳过格式异常的行
- **不主动装包**：脚本需要第三方库时，先询问用户是否允许安装，而非直接执行 `pip install`
- **错误重试上限**：同一脚本最多自动修复 3 次错误，超过后向用户说明并请求手动干预

## 常见错误模式

| 错误 | 原因 | 修复 |
|------|------|------|
| `FileNotFoundError` | 路径错误或文件未加载 | 确认 `read_excel` 中的路径，检查文件是否已在数据页加载 |
| `UnicodeDecodeError` | 文件编码不匹配 | 尝试 `encoding='gbk'` 或 `encoding='utf-8-sig'` |
| `KeyError` | 列名不匹配 | 先用 `print(df.columns.tolist())` 查看实际列名 |
| `PermissionError` | 文件被其他程序占用 | 提示用户关闭 Excel，或写入新文件 |
| `ModuleNotFoundError` | 缺少依赖 | 使用 `pip install <package>` 安装 |
