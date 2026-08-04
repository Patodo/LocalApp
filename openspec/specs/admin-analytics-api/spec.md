## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the admin-analytics-api capability in LocalApp.

## Requirements

### Requirement: 分析统计概览 API
管理员 SHALL 能查看指定时间范围的统计概览。

#### Scenario: 获取分析概览
- **WHEN** admin 发送 `GET /api/admin/analytics/overview?period=7d`
- **THEN** 返回 `{ period, totalRequests, uniqueVisitors, pageViews, avgResponseMs, errorRate }`
- **AND** `period` 支持 `1d`、`7d`、`30d`

### Requirement: 趋势数据 API
管理员 SHALL 能查看按时间聚合的趋势数据。

#### Scenario: 获取趋势数据
- **WHEN** admin 发送 `GET /api/admin/analytics/trends?range=7d`
- **THEN** 返回按天聚合的数据数组 `[{ date, requests, pageViews, newUsers }]`

### Requirement: 页面访问排行 API
管理员 SHALL 能查看页面访问排行。

#### Scenario: 获取页面排行
- **WHEN** admin 发送 `GET /api/admin/analytics/pages?period=7d&limit=20`
- **THEN** 返回 `[{ pagePath, pageName, userId, views, uniqueVisitors }]`，按 views 降序
