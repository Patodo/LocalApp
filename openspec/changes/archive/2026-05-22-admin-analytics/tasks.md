## 1. 数据采集基础设施

- [x] 1.1 `meta-sqlite.ts` 新增 `request_logs` 表（id, path, method, status, duration_ms, user_id, visitor_id, created_at）
- [x] 1.2 `meta-sqlite.ts` 新增 `page_views` 表（id, page_path, visitor_id, created_at）+ 索引
- [x] 1.3 `meta-sqlite.ts` 新增批量写入函数 `insertRequestLogs(entries)`、`insertPageViews(entries)`
- [x] 1.4 `meta-sqlite.ts` 新增清理函数 `cleanOldLogs(days=30)`

## 2. 采集中间件

- [x] 2.1 新建 `lib/request-logger.ts`：内存 buffer + 定时刷盘（5s/100条）+ onClose 刷盘
- [x] 2.2 `index.ts` 注册 requestLogger 插件（onResponse hook 记录 `/api/*` 和 `/serve/*/api/*` 请求）
- [x] 2.3 `serve.ts` Shell 渲染路径记录 page_view（`GET /{userId}/{name}`）
- [x] 2.4 `index.ts` 启动时调用 `cleanOldLogs()` 清理过期数据

## 3. 分析 API

- [x] 3.1 `routes/admin.ts` 新增 `GET /api/admin/analytics/overview?period=7d`（聚合 request_logs + page_views）
- [x] 3.2 `GET /api/admin/analytics/trends?range=7d`（按天 GROUP BY，返回请求量/浏览量/新用户）
- [x] 3.3 `GET /api/admin/analytics/pages?period=7d&limit=20`（页面访问排行，GROUP BY page_path）

## 4. 前端图表

- [x] 4.1 `packages/admin` 安装 recharts 依赖
- [x] 4.2 新建 `src/api/analytics.ts`：封装 analytics API 调用
- [x] 4.3 新建 `src/pages/Analytics.tsx`：时间范围选择器 + 4 个图表区域
- [x] 4.4 请求量趋势折线图（`/trends` 数据）
- [x] 4.5 页面访问排行 Top 10 表格（`/pages` 数据）
- [x] 4.6 用户注册趋势柱状图（`/trends` 数据）
- [x] 4.7 存储增长趋势折线图（`/trends` 数据）
- [x] 4.8 `Layout.tsx` 导航新增"运营大盘"菜单项

## 5. e2e 测试

- [x] 5.1 `tests/e2e/admin-analytics.test.ts`：发送请求后验证 request_logs 有记录
- [x] 5.2 测试 page_views 记录（访问 Shell 页面）
- [x] 5.3 测试 analytics API 返回正确的聚合数据
- [x] 5.4 测试过期数据清理

## 6. 收尾

- [x] 6.1 手动验证运营大盘页面（图表渲染、时间范围切换）
- [x] 6.2 提交所有变更
