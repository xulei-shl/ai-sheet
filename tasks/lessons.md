
## 2026-06-09: SQLite WAL 文件导致数据丢失

### 问题
恢复 SQLite 数据库备份时，只替换了主文件（i-sheet.db），忘了清理残留的 WAL 
（i-sheet.db-wal）和 SHM（i-sheet.db-shm）日志文件。应用重新打开时，
SQLite 的 WAL 回放把空表状态写入了数据库，导致 models 表数据全部丢失。

### 教训
- 操作 SQLite WAL 模式数据库时，主文件（.db）和日志文件（.db-wal、.db-shm）总是一体的
- 备份、恢复时必须同时处理三个文件，否则会导致数据损坏
- 如果只需要新建空数据库，应直接在同一目录操作，不要替换数据库文件后残留旧 WAL
- 在 Database::open() 中加入启动时清理残留 WAL/SHM 的保护逻辑
