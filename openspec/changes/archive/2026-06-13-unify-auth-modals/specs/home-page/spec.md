## MODIFIED Requirements

### Requirement: 公开首页入口

`/` 路径 SHALL 对未登录访问者渲染公开首页，不得自动重定向。公开首页 SHALL 展示完整的新用户引导流程，包含以下步骤（按顺序）：

1. **下载 CLI** — 根据 `/api/cli/version` 返回的可用平台列表，动态展示下载按钮。每个按钮链接到 `/api/cli/download?os=<os>&arch=<arch>`。MUST 根据 `navigator.platform` 在视觉上高亮推荐当前用户的平台。
2. **连接到实例** — 展示 `localapp login <server-origin>` 命令，其中 `<server-origin>` MUST 使用 `window.location.origin` 自动填充，以可复制的代码块形式呈现。
3. **创建应用** — 展示 `localapp init` 命令。
4. **上传部署** — 展示 `localapp upload` 命令，说明将本地构建发布到 LocalApp 并获得在线入口。

当 `/api/cli/version` 返回 404 或无平台可用时，MUST 降级展示纯文本指引（如"请联系管理员获取 CLI"），不得报错或留白。

#### Scenario: 未登录用户看到公开首页
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面返回首页 HTML
- **THEN** 前端渲染 LocalApp 公开首页内容
- **THEN** 浏览器地址不得被自动替换为 `/login?redirect=/`

#### Scenario: 公开首页提供登录弹窗入口
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面显示登录入口，点击后弹出 LoginDialog 模态框（而非跳转页面）
- **THEN** 页面不显示任何注册链接

#### Scenario: 用户看到完整的引导流程
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 首页按顺序展示：下载 CLI、连接到实例、创建应用、上传部署
- **THEN** "连接到实例"步骤展示 `localapp login <当前 server origin>` 命令

#### Scenario: 根据可用平台动态展示下载按钮
- **WHEN** 未登录用户访问 `GET /` 且 server 有 Windows 和 Linux 平台的 CLI
- **THEN** 首页展示 Windows 和 Linux 的下载按钮
- **THEN** 不展示 macOS 下载按钮

#### Scenario: 当前平台被高亮推荐
- **WHEN** Windows 用户访问首页且 Windows 平台可用
- **THEN** Windows 下载按钮在视觉上被高亮为主按钮，其他平台为次按钮

#### Scenario: 无可用平台时降级展示
- **WHEN** `/api/cli/version` 返回 404 或 `versions` 中无平台条目
- **THEN** 下载区域展示纯文本"暂无 CLI 可供下载，请联系管理员"
- **THEN** 其他引导步骤正常展示

## REMOVED Requirements

### Requirement: 公开首页显示注册链接
**Reason**: 浏览器端注册入口已完全移除
**Migration**: 首页不再显示"前往注册"链接
