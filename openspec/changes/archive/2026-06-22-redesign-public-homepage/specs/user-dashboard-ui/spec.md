## ADDED Requirements

### Requirement: 登录后 CLI 获取说明

登录后的用户面板 SHALL 提供 CLI 获取和配置说明入口。该入口 MUST 说明 CLI 需要登录态或 API Key 配置，并提供用户可执行的下一步，例如查看 API Key、运行登录命令或执行更新命令。

#### Scenario: 用户在面板中看到 CLI 获取方式

- **WHEN** 已登录用户访问包含 CLI 说明的用户面板页面
- **THEN** 页面显示 CLI 的用途说明
- **THEN** 页面显示与当前用户相关的配置下一步，例如 API Key 页面、`localapp login` 或 `localapp update`
- **THEN** 页面不得要求用户复制 server 内部 release 目录

#### Scenario: 未登录用户不能访问 CLI 获取说明

- **WHEN** 未登录用户访问 CLI 获取说明所在的 `/my/*` 页面
- **THEN** 页面重定向到登录页

### Requirement: 公开首页到登录后能力的转接

公开首页提到 CLI、API Key 或上传能力时，SHALL 将这些能力描述为登录后可用，不得在公开首页提供需要鉴权的直接操作。

#### Scenario: 公开首页引导登录后获取 CLI

- **WHEN** 未登录用户在公开首页看到 CLI 相关文案
- **THEN** 文案明确说明需要登录后获取或配置
- **THEN** 点击主要入口会在首页打开登录模态框
