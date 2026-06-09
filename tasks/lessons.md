
## 2026-06-09: SQLite WAL 文件导致数据丢失

### 问题
恢复 SQLite 数据库备份时，只替换了主文件（ai-sheet.db），忘了清理残留的 WAL 
（ai-sheet.db-wal）和 SHM（ai-sheet.db-shm）日志文件。应用重新打开时，
SQLite 的 WAL 回放把空表状态写入了数据库，导致 models 表数据全部丢失。

### 教训
- 操作 SQLite WAL 模式数据库时，主文件（.db）和日志文件（.db-wal、.db-shm）总是一体的
- 备份、恢复时必须同时处理三个文件，否则会导致数据损坏
- 如果只需要新建空数据库，应直接在同一目录操作，不要替换数据库文件后残留旧 WAL

## 2026-06-09(2): WAL/SHM startup-delete 导致重复数据丢失

### 问题
之前添加的"启动时清理 WAL/SHM"保护逻辑（fs::remove_file）太粗暴：
在打开数据库连接**之前**就删除了 WAL/SHM 文件，导致上一轮未 checkpoint 的
写入数据全部丢失。每次重启都重复丢失模型配置。

### 教训
- **永远不要在打开连接前手动删除 WAL/SHM** — 这会导致 uncheckpointed 数据丢失
- 正确的做法：先 `Connection::open()`，然后 `PRAGMA wal_checkpoint(TRUNCATE)`
  将待决数据安全刷入主文件后再截断 WAL
- `fs::remove_file` 只应在手动恢复备份时作为操作步骤，不应编入代码逻辑
