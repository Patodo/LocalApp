## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the home-page capability in LocalApp.

## Requirements

### Requirement: 公开首页入口

`/` 路径 SHALL 根据登录态渲染不同首页。未登录用户 SHALL 看到公开产品首页，不得自动重定向到 `/login?redirect=/`。公开首页 SHALL 以品牌化、视觉冲击力强的方式展示 LocalApp 的定位、登录后能力和基础使用流程；已登录用户 SHALL 看到包含三个模块的工作台首页。

公开首页 MAY 说明 CLI 用途，但 MUST 将 CLI 获取、API Key 配置和应用安装能力描述为登录后可用，不得在公开首页提供需要鉴权的直接操作。公开首页 SHALL 避免无后续动作的装饰性控件。

#### Scenario: 未登录用户看到公开首页
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面返回首页 HTML
- **THEN** 前端渲染 LocalApp 公开首页内容
- **THEN** 浏览器地址不得被自动替换为 `/login?redirect=/`

#### Scenario: 公开首页提供登录弹窗入口
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面显示登录入口，点击后弹出 LoginDialog 模态框（而非跳转页面）
- **THEN** 页面不显示任何注册链接

#### Scenario: 用户看到基础使用流程
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面说明登录后可以管理应用、安装应用包、获取 CLI/API Key、查看收藏或访问记录
- **THEN** 页面展示 `localapp init`、`localapp dev`、`localapp app install --target <profile>`、访问正式应用链接的基础流程

#### Scenario: 未登录首页没有控制台入口
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面不得显示指向 `/my/*` 的控制台、工作台或应用管理链接
- **THEN** 页面不得显示"进入平台"这类不明确登录前置条件的 CTA
- **THEN** 页面显示的主要 CTA 文案必须明确表达需要登录

#### Scenario: 首页内完成登录
- **WHEN** 未登录用户在公开首页点击登录入口
- **THEN** 页面在当前 URL 打开登录模态框
- **THEN** 用户提交正确凭据后进入已登录工作台首页
- **THEN** 登录过程中不得因为点击主 CTA 直接导航到 `/login?redirect=/`

#### Scenario: 未登录首页不显示内部路径
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面不得显示 `packages/server/static/cli`
- **THEN** 页面不得提供"复制路径"按钮
- **THEN** 页面可提示"登录后获取 CLI 和 API Key"

### Requirement: 登录后首页工作台体验

`/` 路径 SHALL 在检测到已登录用户后渲染中文工作台页面。页面 SHALL 展示欢迎语、我的应用、收藏应用和最近访问三个主要模块，并为每个模块提供查看全部入口。

#### Scenario: 已登录用户看到工作台
- **WHEN** 已登录用户访问 `GET /`
- **THEN** 页面显示可读的中文欢迎语和模块标题
- **THEN** 页面不得显示错误编码产生的乱码字符

#### Scenario: 工作台模块入口可用
- **WHEN** 已登录用户访问 `GET /`
- **THEN** 我的应用模块的查看全部入口指向 `/my/apps`
- **THEN** 收藏应用模块的查看全部入口指向 `/my/favorites`
- **THEN** 最近访问模块的查看全部入口指向 `/my/recent`

#### Scenario: 已登录用户看到完整首页
- **WHEN** 已登录用户访问 `GET /`
- **THEN** 页面渲染三个模块："我的应用"显示最多 8 个应用卡片、"收藏应用"显示最多 5 条收藏列表、"最近访问"显示最多 5 条访问记录
- **THEN** 每个模块标题右侧显示"查看全部"链接

### Requirement: 我的应用模块

"我的应用"模块 SHALL 通过 `GET /api/me/pages?limit=8` 获取数据，以卡片网格展示。每个卡片 SHALL 显示应用名称。模块标题旁 SHALL 显示应用总数。

#### Scenario: 有应用时显示卡片网格
- **WHEN** 用户拥有 3 个应用
- **THEN** 显示 3 张应用卡片，每张显示应用名称
- **THEN** "查看全部"链接指向 `/my/apps`（我的应用）

#### Scenario: 无应用时显示空状态
- **WHEN** 用户没有应用
- **THEN** 显示空状态提示文字

### Requirement: 收藏应用模块

"收藏应用"模块 SHALL 通过 `GET /api/me/favorites?limit=5` 获取数据，以列表形式展示。每条记录 SHALL 显示应用名称和收藏时间。

#### Scenario: 有收藏时显示列表
- **WHEN** 用户收藏了 2 个应用
- **THEN** 显示 2 条列表项，每条显示应用名称和相对时间
- **THEN** "查看全部"链接指向 `/my/favorites`

#### Scenario: 无收藏时显示空状态
- **WHEN** 用户没有收藏
- **THEN** 显示空状态提示文字

### Requirement: 最近访问模块

"最近访问"模块 SHALL 通过 `GET /api/me/recent?limit=5` 获取数据，以列表形式展示。每条记录 SHALL 显示应用名称和访问时间。

#### Scenario: 有访问记录时显示列表
- **WHEN** 用户最近访问过 4 个应用
- **THEN** 显示 4 条列表项，每条显示应用名称和相对时间，按访问时间倒序排列

#### Scenario: 无访问记录时显示空状态
- **WHEN** 用户没有访问记录
- **THEN** 显示空状态提示文字

### Requirement: 首页模块独立容错

首页工作台的三个数据模块 SHALL 独立请求数据。任一模块请求失败时，页面 MUST 保持可用，并只在该模块内显示空状态或错误状态，不得阻塞其他模块渲染。

#### Scenario: 单个模块失败不影响首页
- **WHEN** 我的应用接口请求成功但收藏应用接口请求失败
- **THEN** 我的应用模块正常显示数据
- **THEN** 收藏应用模块显示空状态或错误状态
- **THEN** 最近访问模块继续独立加载或显示数据
