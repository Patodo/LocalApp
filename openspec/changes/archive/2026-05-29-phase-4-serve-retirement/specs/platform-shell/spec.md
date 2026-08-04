## ADDED Requirements

### Requirement: PlatformShell 组件

`PlatformShell` React 组件 SHALL 渲染应用的 iframe 外壳：顶部导航栏 + 全屏 iframe + Issue 模态框。组件 SHALL 从 URL params 获取 `userId` 和 `name`，从 `/api/me` 获取当前用户信息。

#### Scenario: 渲染平台外壳
- **WHEN** 访问 `/:userId/:name`
- **THEN** 显示顶部导航栏（包含应用名、Issue 按钮）
- **THEN** 显示全屏 iframe 加载用户应用
- **THEN** iframe 的 `src` 属性指向 `/serve/:userId/:name/`

#### Scenario: 已登录用户看到完整导航栏
- **WHEN** 已登录用户访问平台外壳
- **THEN** 导航栏右侧显示收藏按钮和头像
- **THEN** 点击头像可登出

#### Scenario: 未登录用户看到登录按钮
- **WHEN** 未登录用户访问平台外壳
- **THEN** 导航栏右侧显示登录按钮
- **THEN** 点击登录跳转到 `/login?redirect=...`

#### Scenario: shell navbar 禁用时重定向
- **WHEN** 应用的 shell 配置中 `navbar === false`
- **THEN** 页面重定向到 `/serve/:userId/:name/`（无壳直接访问）

### Requirement: Navbar 组件

导航栏 SHALL 分为左右两个区域。左侧 SHALL 包含应用名称和 Issue 按钮（CircleDot 图标）。右侧 SHALL 包含收藏按钮（星标图标 + 收藏数量）、头像（已登录时）或登录按钮（未登录时）。导航栏 SHALL 固定在页面顶部。

#### Scenario: Issue 按钮可见
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏左侧显示 CircleDot 图标按钮
- **THEN** 点击打开 Issue 模态框

#### Scenario: 收藏按钮显示星标数量
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏右侧显示星标图标 + 收藏数量
- **THEN** 点击收藏按钮切换收藏状态

### Requirement: IssuesModal 组件

`IssuesModal` SHALL 提供 Issue 的完整管理界面。SHALL 包含列表视图（按状态/标签筛选）和创建表单（title + description + label）。创建 Issue 和关闭 Issue 的权限验证 SHALL 和当前 API 一致。

#### Scenario: 查看 Issue 列表
- **WHEN** 点击 Issue 按钮
- **THEN** 显示模态框 + Issue 列表
- **THEN** 可按状态（open/closed）和标签（bug/feature）筛选

#### Scenario: 创建新 Issue
- **WHEN** 已登录用户点击 New Issue 按钮
- **THEN** 切换到创建表单
- **THEN** 填写 title、description、选择 label（bug/feature）
- **THEN** 提交后 Issue 出现在列表中

#### Scenario: 关闭 Issue
- **WHEN** Issue 的创建者或应用所有者点击关闭按钮
- **THEN** Issue 状态变为 closed
- **THEN** 关闭按钮变为重新打开按钮

#### Scenario: 未登录用户只能查看
- **WHEN** 未登录用户打开 Issue 模态框
- **THEN** 可查看 Issue 列表
- **THEN** 不显示创建 Issue 按钮

### Requirement: serve.ts 精简

`serve.ts` 文件 SHALL 移除所有 HTML 模板函数（`buildPlatformShell`、`buildLoginPage`、`buildRegisterPage`、`buildForceChangePasswordPage`）。文件 SHALL 只保留 API 路由（CRUD、文件上传）和静态文件服务。

#### Scenario: serve.ts 仅包含 API 逻辑
- **WHEN** 检查 `serve.ts` 文件
- **THEN** 无 HTML 模板字符串函数
- **THEN** CRUD API 和静态文件路由正常工作
