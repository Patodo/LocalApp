## MODIFIED Requirements

### Requirement: 首页三模块布局

`/` 路径 SHALL 根据登录态渲染不同首页。未登录用户 SHALL 看到公开产品首页，不得自动重定向到 `/login?redirect=/`。已登录用户 SHALL 看到包含三个模块的工作台首页：我的应用（卡片网格）、收藏应用（列表）、最近访问（列表）。已登录用户 SHALL 看到三个模块的实际数据。

#### Scenario: 已登录用户看到完整首页

- **WHEN** 已登录用户访问 `GET /`
- **THEN** 页面渲染三个模块：“我的应用”显示最多 8 个应用卡片，“收藏应用”显示最多 5 条收藏列表，“最近访问”显示最多 5 条访问记录
- **THEN** 每个模块标题右侧显示“查看全部”链接

#### Scenario: 未登录用户看到公开首页

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面渲染公开产品首页
- **THEN** 浏览器地址不得被自动替换为 `/login?redirect=/`
- **THEN** 页面显示登录入口，点击后在当前首页打开登录模态框

## ADDED Requirements

### Requirement: 公开首页禁止误导性入口

未登录公开首页 SHALL NOT 展示控制台、工作台、应用管理、上传应用等暗示无需登录即可操作平台的入口。公开首页的主要行动入口 SHALL 是登录，且登录 SHOULD 在首页内以模态框完成。

#### Scenario: 未登录首页没有控制台入口

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面不得显示指向 `/my/*` 的控制台、工作台或应用管理链接
- **THEN** 页面不得显示“进入平台”这类不明确登录前置条件的 CTA
- **THEN** 页面显示的主要 CTA 文案必须明确表达需要登录

#### Scenario: 首页内完成登录

- **WHEN** 未登录用户在公开首页点击登录入口
- **THEN** 页面在当前 URL 打开登录模态框
- **THEN** 用户提交正确凭据后进入已登录工作台首页
- **THEN** 登录过程中不得因为点击主 CTA 直接导航到 `/login?redirect=/`

### Requirement: 公开首页不暴露内部 CLI 产物路径

未登录公开首页 SHALL NOT 展示 server 内部 CLI release 目录、仓库相对路径或复制内部路径按钮。公开首页 MAY 说明 CLI 用途，但 MUST 将 CLI 获取方式引导到登录后页面。

#### Scenario: 未登录首页不显示内部路径

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面不得显示 `packages/server/static/cli`
- **THEN** 页面不得提供“复制路径”按钮
- **THEN** 页面可提示“登录后获取 CLI 和 API Key”

### Requirement: 公开首页信息架构

未登录公开首页 SHALL 以品牌化、视觉冲击力强的公开首页展示 LocalApp 的定位、登录后能力和基础使用流程。页面 MAY 使用强烈首屏、深色舞台、产品化控制台视觉和动感光效，但 SHALL 避免无后续动作的装饰性控件。

#### Scenario: 公开首页说明登录后能力

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面说明登录后可以管理应用、上传构建产物、获取 CLI/API Key、查看收藏或访问记录
- **THEN** 页面展示 `localapp init`、实现应用、`localapp upload`、访问应用链接的基础流程
