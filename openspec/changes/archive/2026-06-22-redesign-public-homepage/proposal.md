## Why

当前 `/` 首页把公开介绍、登录后工作台、内部 CLI 产物目录混在一起，导致未登录用户看到误导性的“控制台/进入平台”入口，以及没有后续意义的“复制内部路径”操作。需要重新定义公开首页的信息架构，让它只承担产品说明和登录引导，并把 CLI 获取方式放回登录后的用户面板。

## What Changes

- 重新设计未登录访问 `/` 时的公开首页：以更强品牌视觉展示 LocalApp 定位、核心使用流程和登录后可获得的能力。
- 将公开首页登录入口改为首页内模态框，不再让主 CTA 离开首页跳转到独立登录页。
- 移除公开首页中的内部实现路径展示，例如 `packages/server/static/cli`，以及任何“复制内部路径”按钮。
- 移除公开首页中会误导未登录用户的控制台入口；未登录用户只能看到明确的登录入口，登录在首页模态框中完成。
- 保留已登录用户访问 `/` 时的工作台体验：我的应用、收藏应用、最近访问。
- 在登录后的用户面板中提供 CLI 获取说明或入口，说明 CLI 下载/更新需要登录态和 API Key，而不是让公开首页暴露 server 内部目录。
- 更新 Docker 镜像打包约定，确保发布镜像时包含 `packages/server/static/cli` 下的 CLI 版本清单和二进制产物，使登录后的下载/更新入口实际可用。
- 不改变 CLI 下载 API、自更新协议或二进制产物落盘流程。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `home-page`: 重新定义公开首页和登录后工作台的职责边界，禁止公开首页展示内部 CLI 路径或未登录控制台入口。
- `user-dashboard-ui`: 登录后的用户面板需要承接 CLI 获取说明或入口，让用户知道如何拿到 CLI、API Key 和更新命令。
- `cli-update`: 明确 CLI release 目录是 server 内部发布约定，不属于公开首页展示内容；用户侧只应看到下载/更新方式。
- `docker-packaging`: Docker 镜像构建时需要携带已发布的 CLI 静态产物，保证 `/api/cli/version` 和 `/api/cli/download` 在容器环境中可用。

## Impact

- 影响 Next.js 首页组件：`packages/web/app/(dashboard)/page.tsx`。
- 影响 dashboard shell 对 `/` 的未登录放行逻辑：`packages/web/components/app-shell.tsx`。
- 可能影响用户面板中的设置页、API Key 页或新增下载说明区。
- 影响 Dockerfile：需要复制 CLI 静态产物目录到镜像中的 server 静态目录。
- 不影响 server CLI 下载接口、CLI 自更新命令和 release 脚本。
