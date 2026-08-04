## Context

`/` 当前处在 dashboard 分组下，外层 `AppShell` 原本会保护所有 dashboard 页面。为了支持公开首页，根路径需要在未登录时绕过登录保护，但 `/my/*` 仍必须受保护。前一次实现把 CLI release 内部目录展示在公开首页，并提供“复制路径”按钮；这对最终用户没有可执行的下一步，也泄露了实现细节，应该撤回。

## Goals / Non-Goals

**Goals:**

- 将 `/` 设计成真正的公开产品首页，面向未登录访问者说明 LocalApp 是什么、登录后能做什么。
- 未登录公开首页只提供登录入口，不提供控制台、应用管理、上传、复制内部路径等操作；登录入口 SHALL 在首页内打开模态框完成认证。
- 将 CLI 获取和 API Key 配置说明放到登录后的用户面板，形成可执行的下一步。
- 确保 Docker 镜像包含已经发布到 `packages/server/static/cli` 的 CLI 版本清单和二进制产物，让容器内下载接口可用。
- 已登录用户继续把 `/` 作为工作台入口，展示我的应用、收藏和最近访问。

**Non-Goals:**

- 不改变 CLI 二进制实际落盘目录。
- 不改变 `/api/cli/version`、`/api/cli/download` 或 `localapp update` 协议。
- 不在公开首页提供免登录下载 CLI。
- 不引入新的营销站点框架或外部 UI 依赖。
- 不在 Docker 构建阶段现场编译 Rust CLI；镜像只复制本地/CI 已经生成并发布到静态目录的产物。

## Decisions

- 公开首页保留在 `/`，但按登录态分支渲染。未登录显示产品说明，已登录显示工作台。这避免新增路由，也符合用户从根路径进入平台的预期。
- 公开首页的唯一行动入口是登录，且登录应作为首页内模态框出现。替代方案是跳转到 `/login?redirect=/`，但这会打断首页体验，让首页不像真正的公开入口。
- 公开首页不得展示 `packages/server/static/cli` 等内部路径。替代方案是继续展示但加解释；这仍然无法回答“用户复制后做什么”，所以不采用。
- CLI 获取说明放在登录后的 `/my/keys` 或设置相关区域。该区域已经承载 API Key，天然适合展示 CLI 登录、更新和下载说明。
- Dockerfile 复制 `packages/server/static/cli/` 到镜像。当前 Dockerfile 只复制 server dist/src 和 web out，容器中会缺少 `versions.json` 与二进制文件；复制静态目录可以沿用现有 server 路由，不改变下载 API。替代方案是在 Docker build 中运行 `cargo build --release`，但这会引入 Rust toolchain、拉长镜像构建，并让跨平台产物更复杂。
- 视觉风格采用品牌化、冲击力更强的公开首页：允许强烈的光效、深色舞台、产品化控制台视觉和更具传播性的首屏表达。后台应用的克制工具风格不约束公开首页。

## Risks / Trade-offs

- [Risk] 根路径按登录态分支会让公开首页和工作台共用一个组件，复杂度上升。→ 将公开首页和工作台拆成独立子组件，避免状态和文案混杂。
- [Risk] 登录后 CLI 获取入口放到 `/my/keys` 可能让用户不容易发现。→ 在公开首页只提示“登录后在 API Key/CLI 区域获取”，登录后页面提供明确标题和操作步骤。
- [Risk] 公开首页过度营销会偏离工具平台气质。→ 设计验收要求限制 CTA 数量、禁止内部路径、聚焦真实工作流和登录后能力。
- [Risk] Docker 镜像复制静态 CLI 目录时，本地/CI 可能尚未生成产物。→ Docker 构建前置要求运行 CLI release 发布脚本；缺少产物时构建应失败或在文档/任务中明确验证 `versions.json` 存在。

## Migration Plan

1. 更新 `/` 首页未登录态的信息架构和视觉实现。
2. 保持 `AppShell` 对 `/` 未登录放行，对 `/my/*` 继续重定向登录。
3. 在登录后用户面板中增加 CLI 获取/配置说明入口。
4. 更新 Dockerfile 复制 CLI 静态产物目录，并验证容器文件布局或构建上下文。
5. 使用 Playwright 或 in-app Browser 验证未登录首页、登录入口和禁止项。

## Open Questions

- CLI 获取说明具体放在 `/my/keys` 还是 `/my/settings`，实施前可根据现有页面信息结构选择；默认推荐 `/my/keys`。
- Docker 构建缺少 CLI 产物时应该硬失败，还是允许无 CLI 的开发镜像；默认推荐生产镜像硬失败。
