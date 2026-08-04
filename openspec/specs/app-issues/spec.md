# app-issues

## Purpose

[TBD] 定义平台 Issue 系统的行为规范，包括 Issue 数据模型、CRUD API 接口，以及前端 Issue 模态框的交互行为。Issue 数据存储在每个应用的 `app.db` 中。

## Requirements

### Requirement: Issue 数据表

系统 SHALL 在每个应用的 `app.db` 中创建 `_issues` 表，包含以下字段：`id`（自增主键）、`issue_number`（应用内自增编号）、`title`（标题）、`description`（描述，默认空字符串）、`status`（`open` 或 `closed`，默认 `open`）、`label`（`bug` 或 `feature`，默认 `bug`）、`reporter_id`（创建者用户 ID）、`created_at`（创建时间）、`updated_at`（更新时间）。`issue_number` 在每个应用内独立自增。

#### Scenario: 首次访问时自动建表
- **WHEN** 首次连接某个应用的 `app.db` 并执行 Issue 操作
- **THEN** `_issues` 表被创建（如不存在），含所有必要字段

#### Scenario: Issue 编号独立自增
- **WHEN** 在应用 A 创建了 #1、#2，在应用 B 创建第一个 Issue
- **THEN** 应用 B 的 Issue 编号为 #1

### Requirement: 查询 Issue 列表

系统 SHALL 提供 `GET /api/issues` 接口，接受查询参数 `pagePath`（必填）、`status`（可选，`open` 或 `closed`）、`label`（可选，`bug` 或 `feature`），返回该应用的 Issue 列表，按创建时间倒序排列。此接口无需登录即可访问。

#### Scenario: 查询所有 Open Issue
- **WHEN** 匿名用户 GET `/api/issues?pagePath=alice/myapp&status=open`
- **THEN** 返回 `{ success: true, data: [...] }`，每个元素含 id、issueNumber、title、description、status、label、reporterId、createdAt、updatedAt

#### Scenario: 按标签筛选
- **WHEN** 用户 GET `/api/issues?pagePath=alice/myapp&label=bug`
- **THEN** 仅返回 label 为 `bug` 的 Issue

#### Scenario: 无 Issue 时返回空列表
- **WHEN** 应用没有任何 Issue
- **THEN** 返回 `{ success: true, data: [] }`

#### Scenario: 缺少 pagePath 参数
- **WHEN** 请求未提供 `pagePath` 参数
- **THEN** 返回 400 状态码和错误消息

### Requirement: 创建 Issue

系统 SHALL 提供 `POST /api/issues` 接口，接受 JSON body `{ pagePath, title, description?, label? }`，为指定应用创建新 Issue。需要登录。首次在某个应用创建 Issue 时，`issue_number` 从 1 开始自增。

#### Scenario: 成功创建 Issue
- **WHEN** 已登录用户 POST 有效数据到 `/api/issues`
- **THEN** 返回 `{ success: true, data: { id, issueNumber, ... } }`，Issue 写入 `_issues` 表，状态默认为 `open`

#### Scenario: 未登录用户创建失败
- **WHEN** 未登录用户 POST 创建 Issue
- **THEN** 返回 401 状态码

#### Scenario: 缺少必填字段
- **WHEN** 请求缺少 `pagePath` 或 `title`
- **THEN** 返回 400 状态码和错误消息

#### Scenario: Issue 编号自增
- **WHEN** 应用已有 #1，创建第二个 Issue
- **THEN** 新 Issue 的 issueNumber 为 2

### Requirement: 更新 Issue

系统 SHALL 提供 `PATCH /api/issues/:id` 接口，接受 JSON body `{ status?, label? }`，更新指定 Issue 的状态或标签。仅 Issue 创建者或应用 owner 有权操作。需要登录。

#### Scenario: 创建者关闭 Issue
- **WHEN** Issue 创建者 PATCH `{ status: "closed" }` 到 `/api/issues/:id`
- **THEN** 返回 `{ success: true, data: { ... } }`，Issue 状态更新为 `closed`

#### Scenario: 非创建者且非 owner 操作失败
- **WHEN** 用户既不是 Issue 创建者也不是应用 owner，尝试 PATCH
- **THEN** 返回 403 状态码

#### Scenario: 应用 owner 可关闭他人 Issue
- **WHEN** 应用 owner 对属于自己应用的 Issue 执行 PATCH
- **THEN** 操作成功

#### Scenario: 未登录用户操作失败
- **WHEN** 未登录用户 PATCH
- **THEN** 返回 401 状态码

### Requirement: Issue 按钮

系统 SHALL 在平台导航栏左侧（应用名称旁边）渲染 Issue 按钮，使用 Lucide CircleDot 图标。按钮对所有访问者可见。

#### Scenario: Issue 按钮渲染
- **WHEN** 任何用户访问 `/:userId/:name` 页面
- **THEN** 导航栏左侧应用名称旁显示 CircleDot 图标按钮

#### Scenario: 点击打开模态框
- **WHEN** 用户点击 Issue 按钮
- **THEN** Issue 模态框弹出，自动加载该应用的 Issue 列表

### Requirement: Issue 模态框

系统 SHALL 在 Shell 页面中内嵌 Issue 模态框（隐藏状态），包含 Issue 列表视图和新建表单视图。列表视图支持状态和标签筛选、显示 Issue 列表。新建表单包含标题和描述输入。

#### Scenario: 模态框列表视图
- **WHEN** 模态框打开
- **THEN** 显示该应用的 Issue 列表，包含 Open/Closed 切换按钮、标签筛选下拉、新建按钮、每个 Issue 的编号、标题、状态图标、标签、创建者和创建时间

#### Scenario: 空列表状态
- **WHEN** 应用没有任何 Issue（或当前筛选条件无匹配）
- **THEN** 显示空状态提示："暂无 Issue"

#### Scenario: 切换到新建表单
- **WHEN** 用户点击"新建 Issue"按钮
- **THEN** 列表视图切换为新建表单（标题输入框 + 描述文本框 + 标签选择 + 提交/取消按钮）

#### Scenario: 成功创建后刷新列表
- **WHEN** Issue 创建成功
- **THEN** 模态框切换回列表视图并自动刷新

#### Scenario: 关闭模态框
- **WHEN** 用户点击遮罩层或关闭按钮（✕）
- **THEN** 模态框隐藏
