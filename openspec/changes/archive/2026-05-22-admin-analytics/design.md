## Context

admin-foundation 提供了基于文件系统的静态统计（用户数、页面数、存储量），admin-panel 可以展示当前快照。但缺少时间维度的数据——无法看到趋势、无法知道"这周 vs 上周"的变化。需要请求日志采集和聚合分析能力。

## Goals / Non-Goals

**Goals:**
- 采集 API 请求日志（路径、方法、状态码、耗时、用户）
- 采集页面访问日志（哪个页面被谁在何时访问）
- 异步批量写入，不影响正常请求性能
- 提供按时间聚合的统计 API（概览、趋势、排行）
- 管理面板新增运营大盘页面，用图表展示趋势

**Non-Goals:**
- 不做实时推送（WebSocket/SSE），只提供查询 API
- 不做细粒度监控（如单次请求追踪、慢查询分析）
- 不做告警系统
- 不做数据导出（CSV/PDF）
- 不做日志长期存储——SQLite 不适合海量日志，保留近 30 天数据

### D1: 日志存储在 meta.sqlite

新增 `request_logs` 和 `page_views` 两张表。使用已有的 SQLite 连接，不引入新的存储引擎。

**Why:** meta.sqlite 已经在用，单进程架构不需要分库。SQLite 对写入量 <1000 QPS 足够。30 天数据约百万级记录，SQLite 可处理。

### D2: 内存 buffer + 定时刷盘

请求完成后将日志条目推入内存数组（buffer），每 5 秒或 buffer 达到 100 条时批量 INSERT。服务关闭时（onClose hook）刷盘。

**Why:** 每次 INSERT 有磁盘 IO 开销。批量写入减少磁盘操作次数，将性能影响降到可忽略。

### D3: 数据清理策略

每天凌晨（或服务启动时）执行 `DELETE FROM request_logs WHERE created_at < datetime('now', '-30 days')`。`page_views` 同理。

**Why:** SQLite 数据库文件会无限增长。30 天保留期平衡了分析需求和存储开销。

### D4: 聚合查询使用 SQL

趋势数据通过 `GROUP BY date(created_at)` 直接在 SQL 中完成聚合，不需要在应用层计算。创建适当的索引加速查询。

**Why:** SQLite 的聚合查询性能好，百万级数据 `GROUP BY` 毫秒级完成。避免在 JS 中处理大量原始数据。

### D5: 图表库选型 — recharts

使用 recharts 作为图表库，React 生态最主流的轻量图表方案。

**Why:** 声明式 API，与 React 集成自然，bundle 约 200KB gzipped，满足折线图和柱状图需求。

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| 日志写入增加 SQLite 负担 | 可能影响 CRUD 操作延迟 | 批量写入 + 独立写入事务 |
| SQLite 单文件写锁 | 高并发时可能锁竞争 | 当前单进程架构，WAL 模式缓解 |
| 30 天数据可能不够分析 | 长期趋势无法看到 | 后续可考虑迁到 ClickHouse 等 |
| recharts 增大面板 bundle | 面板加载变慢 | 按需加载（lazy import analytics 页面） |
