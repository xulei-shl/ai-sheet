---
name: python-processing
description: Python 数据处理工作流。使用 pandas + openpyxl 编写并执行 Python 脚本处理 Excel 数据，自动修复错误，直到成功。当用户需要用 Python 处理 Excel 数据时使用此技能。
---

# Python 数据处理

## 工作流程

1. **了解数据**：使用 `read_excel` 查看文件结构、Sheet 列表、列名和样本数据
2. **确认需求**：与用户多轮对话，明确处理目标、处理范围、期望输出格式和写入位置
3. **制定执行计划**：简要说明将读取哪些 Sheet/列、如何处理、是否会写回 Excel，并在涉及写入或覆盖时先获得用户确认
4. **编写脚本**：使用 `write` 工具创建 `.py` 文件，遵循下方模板和最佳实践
5. **执行脚本**：使用 `bash` 工具运行 `python <script>.py`
6. **检查结果**：
   - 若成功：展示关键输出、样本结果和生成文件位置，询问用户是否满意
   - 若出错：分析 stderr，记录错误原因和修复点，修正脚本后回到步骤 5
   - 同一脚本最多自动修复 3 次，超过后向用户说明当前判断、已尝试的修复和需要人工确认的信息
7. **写入 Excel**：若需将结果写回 Excel，优先写入新列、新 Sheet 或新文件；任何覆盖原始数据的操作必须先向用户确认
8. **自我提升检查**：如果过程中出现错误、重试、用户纠正、特殊数据坑或新的可复用经验，使用 `/skill:self-improvement` 询问用户是否将经验沉淀到 `.pi/AGENTS.md` 或相关技能文档

## 脚本模板

```python
import pandas as pd
import sys
from pathlib import Path

# 文件路径（从上下文获取或询问用户）
file_path = Path(r"PATH_HERE")
sheet_name = "SHEET_HERE"

if not file_path.exists():
    raise FileNotFoundError(f"文件不存在: {file_path}")

# 读取数据
df = pd.read_excel(file_path, sheet_name=sheet_name)

print(f"数据形状: {df.shape}")
print(f"列名: {list(df.columns)}")
print("前 5 行数据:")
print(df.head())

# === 在此添加数据处理逻辑 ===

# 输出结果
print("处理后前 10 行数据:")
print(df.head(10))
print(f"处理后数据形状: {df.shape}")
```

## 调试与重试规则

每次脚本执行失败后，必须记录并说明：

- **错误信息**：stderr 中的关键异常和堆栈位置
- **可能根因**：例如路径错误、列名不匹配、编码问题、依赖缺失、文件被占用
- **修复动作**：本次修改了哪些代码
- **验证方式**：重新执行脚本后如何确认修复有效

自动修复规则：

1. 不要盲目反复运行同一脚本；每次重试前必须有明确修改
2. 同一脚本最多自动修复 3 次
3. 第 2 次及以上重试后，应更详细地打印中间状态，例如列名、数据类型、空值统计、文件路径
4. 达到 3 次仍失败时，停止自动修复，向用户说明已尝试方案并请求补充信息或人工确认
5. 如果错误模式具有复用价值，使用 `/skill:self-improvement` 询问用户是否沉淀经验

## 最佳实践

- **始终先打印数据概况**：执行脚本后先确认数据读取正确
- **路径使用 raw string 或 pathlib**：`r"C:\path\to\file.xlsx"` 或 `Path(r"C:\path\to\file.xlsx")`，避免转义问题
- **先验证列名**：访问列名前先打印 `df.columns.tolist()`；列名异常时打印 `[repr(c) for c in df.columns]`
- **清理列名空白**：必要时使用 `df.columns = df.columns.astype(str).str.strip()` 处理前后空格
- **编码处理**：如遇编码问题，添加 `encoding='utf-8'`、`encoding='utf-8-sig'` 或 `encoding='gbk'`
- **大文件谨慎处理**：超过 10MB 的文件先确认数据量和内存风险，必要时分块读取或只读取必要列
- **保存前备份**：写入 Excel 前确认用户意图，避免覆盖原始数据
- **优先非破坏性输出**：优先写入新文件、新 Sheet 或新列
- **使用 print 输出**：所有关键中间结果用 `print()` 输出，便于调试
- **格式异常处理**：读取 CSV 时可添加 `on_bad_lines='skip'` 跳过格式异常的行，但需告知用户可能丢弃异常行
- **不主动装包**：脚本需要第三方库时，先询问用户是否允许安装，而非直接执行 `pip install`
- **错误重试上限**：同一脚本最多自动修复 3 次错误，超过后向用户说明并请求手动干预
- **沉淀可复用经验**：执行完成后，如果出现值得复用的错误模式或处理技巧，触发 `/skill:self-improvement`

## 常见错误模式

| 错误                                        | 原因                                     | 修复                                                         |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `FileNotFoundError`                         | 路径错误、文件未加载或当前工作目录不一致 | 确认 `read_excel` 中的路径，优先使用绝对路径或 `Path(r"...")` |
| `UnicodeDecodeError`                        | 文件编码不匹配                           | 尝试 `encoding='utf-8-sig'`、`encoding='gbk'` 或询问用户文件来源 |
| `KeyError`                                  | 列名不匹配                               | 先用 `print(df.columns.tolist())` 查看实际列名，再修正代码   |
| `KeyError` 且列名看似存在                   | 列名包含空格、换行或不可见字符           | 打印 `[repr(c) for c in df.columns]`，必要时执行 `df.columns = df.columns.astype(str).str.strip()` |
| `PermissionError`                           | 文件被 Excel 或其他程序占用              | 提示用户关闭 Excel，或改为写入新文件                         |
| `ModuleNotFoundError`                       | 缺少依赖                                 | 先询问用户是否允许安装；若不同意，改用已安装库或 Python 内置库实现 |
| `ValueError: Worksheet named ... not found` | Sheet 名称错误                           | 使用 `read_excel` 或 `pd.ExcelFile(file_path).sheet_names` 查看实际 Sheet 名称 |
| 日期解析错误                                | 日期格式不一致或区域设置不同             | 先查看原始值样本，再使用 `pd.to_datetime(..., errors='coerce')` 并统计无法解析的行 |
| 数字被当作文本                              | Excel 单元格格式或混合类型导致           | 使用 `pd.to_numeric(..., errors='coerce')`，并检查转换失败数量 |
| 前导零丢失                                  | 编号、手机号、身份证号被当作数字读取     | 读取时指定 `dtype=str`，写出时注意保持文本格式               |

## 自我提升触发示例

以下情况完成处理后，应主动询问用户是否沉淀经验：

- 修复了 2 次以上才成功
- 发现列名中存在不可见字符
- 发现某类 Excel 文件必须用特定编码或 Sheet 读取方式
- 用户纠正了脚本输出格式、写入位置或安全操作方式
- 遇到新的 pandas/openpyxl 常见错误
- 发现本技能文档缺少关键步骤

询问示例：

```
这次 Python 处理过程中出现了列名不匹配问题，根因是 Excel 列名包含前后空格。

我通过打印 repr 形式列名并执行 df.columns.str.strip() 修复了问题。

是否需要我使用 /skill:self-improvement 将这条经验沉淀到 Python 处理技能中?
```

