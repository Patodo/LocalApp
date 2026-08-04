## ADDED Requirements

### Requirement: Next dev 代理不劫持 /serve 语义

`packages/web` 的 Next dev 配置 SHALL NOT 将 `/serve/:path*` 作为通用 rewrite 代理到 server。`/serve` 在平台 server 中代表裸应用资源路径，Next dev SHALL 使用不冲突的内部路径代理裸资源。

#### Scenario: /serve rewrite 不存在
- **WHEN** 检查 `packages/web/next.config.ts` 的 development rewrites
- **THEN** rewrites SHALL NOT 包含 `source: "/serve/:path*"`
- **AND** PlatformShell 模板路由 SHALL NOT 被 `/serve` 代理抢占

#### Scenario: 内部裸资源代理可用
- **WHEN** Next dev server 运行在 3001 端口，server 运行在 3000 端口
- **THEN** 请求 `GET /_localapp/raw/example-user/sample-app/` SHALL 代理到 `http://localhost:3000/serve/example-user/sample-app/`
- **AND** 返回上传应用的裸 `index.html`

### Requirement: PlatformShell 根据环境解析裸应用资源 base

`PlatformShell` SHALL 在生产正式入口中使用 `/serve/{userId}/{name}/` 加载上传应用资源；在 Next dev shell 预览中 SHALL 使用内部代理路径加载相同资源，避免跨 origin 和 `/serve` rewrite 冲突。

#### Scenario: 生产环境使用 /serve resource base
- **WHEN** 用户通过 server 正式入口 `/{userId}/{name}` 打开应用
- **THEN** PlatformShell SHALL fetch `/serve/{userId}/{name}/`
- **AND** 应用 CSS 和 JS asset SHALL 从 `/serve/{userId}/{name}/...` 加载

#### Scenario: Next dev 预览使用内部代理 resource base
- **WHEN** 平台开发者通过 `http://localhost:3001/platform-shell/{userId}/{name}` 打开 shell 预览
- **THEN** PlatformShell SHALL fetch `/_localapp/raw/{userId}/{name}/`
- **AND** 应用 CSS 和 JS asset SHALL 从 `/_localapp/raw/{userId}/{name}/...` 加载
- **AND** 浏览器 SHALL NOT 因 `/serve` 301/308 跳转进入重定向循环
