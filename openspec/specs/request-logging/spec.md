## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the request-logging capability in LocalApp.

## Requirements

### Requirement: API 请求日志采集
系统 SHALL 记录所有 API 请求的日志。

#### Scenario: 记录 API 请求
- **WHEN** 任意请求访问 `/api/*` 或 `/serve/*/api/*`
- **THEN** 记录 `path`、`method`、`status`、`duration_ms`、`user_id`（如已认证）、`visitor_id`（如已登录）、`created_at`

#### Scenario: 批量异步写入
- **WHEN** 日志条目产生
- **THEN** 先推入内存 buffer，每 5 秒或 buffer 达到 100 条时批量 INSERT 到 SQLite
- **AND** 服务关闭时（onClose hook）刷盘剩余 buffer

#### Scenario: 自动清理过期数据
- **WHEN** 服务启动时
- **THEN** 删除 `request_logs` 和 `page_views` 中超过 30 天的记录

### Requirement: 页面访问日志采集
系统 SHALL 记录页面浏览。

#### Scenario: 记录页面访问
- **WHEN** 用户访问 `GET /{userId}/{name}`（Shell 渲染）
- **THEN** 记录 `page_path`、`visitor_id`、`created_at` 到 `page_views` 表
