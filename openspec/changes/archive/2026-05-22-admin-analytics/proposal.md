## Why

管理面板能展示当前状态（用户数、页面数、存储量），但看不到趋势和变化。管理员无法回答"这周有多少新注册？"、"哪个页面访问最多？"、"存储增长速度如何？"。需要数据采集和分析能力来支撑运营决策。

## What Changes

- 新增请求日志中间件，记录 API 请求和页面访问到 SQLite（meta.sqlite 新增 request_logs、page_views 表）
- 批量异步写入策略（内存 buffer → 定时刷盘），避免影响正常请求性能
- 新增 3 个分析 API：概览统计、趋势数据（按天/小时聚合）、页面访问排行
- 管理面板新增"运营大盘"页面，展示请求量趋势、页面排行、用户增长、存储趋势图表
- 使用轻量图表库（如 recharts）渲染可视化图表

## Capabilities

### New Capabilities

- `request-logging`: 请求日志采集——中间件拦截、buffer 聚合、异步持久化、数据表设计
- `admin-analytics-api`: 分析统计 API——概览、趋势、排行的聚合查询
- `admin-analytics-ui`: 运营大盘图表——趋势折线图、访问排行、增长柱状图

### Modified Capabilities

- `admin-api`: 新增 3 个分析端点（`/api/admin/analytics/overview`、`/trends`、`/pages`）

## Impact

- `packages/server/src/lib/meta-sqlite.ts` — 新增 request_logs、page_views 表和查询函数
- `packages/server/src/plugins/` — 新增 requestLogger 插件（或 lib/ 中间件）
- `packages/server/src/routes/admin.ts` — 新增 analytics 路由
- `packages/admin/` — 新增 Analytics 页面和图表组件
- 依赖 admin-foundation 和 admin-panel 变更
