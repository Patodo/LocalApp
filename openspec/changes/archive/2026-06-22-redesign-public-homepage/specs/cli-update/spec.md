## ADDED Requirements

### Requirement: CLI release 目录为内部发布约定

CLI release 目录 SHALL 作为 server 内部发布和下载接口使用的实现约定，不得作为未登录公开首页的用户操作对象展示。用户侧页面 SHOULD 展示下载、登录或更新方式，而不是展示仓库内部文件路径。

#### Scenario: 公开页面不展示 release 目录

- **WHEN** 未登录用户访问公开首页
- **THEN** 页面不得显示 `packages/server/static/cli`
- **THEN** 页面不得要求用户复制该目录路径

#### Scenario: 登录后页面展示用户可执行命令

- **WHEN** 已登录用户查看 CLI 获取说明
- **THEN** 页面展示用户可执行的 CLI 命令或下载入口
- **THEN** 页面可提及版本和更新机制，但不得把内部目录当作用户步骤

### Requirement: 容器环境 CLI 下载可用

当 LocalApp 以生产 Docker 镜像运行时，CLI 版本查询和下载接口 SHALL 使用镜像内携带的 CLI 静态产物提供服务。

#### Scenario: 容器内查询 CLI 版本

- **WHEN** 容器内 server 收到有效鉴权的 `GET /api/cli/version`
- **THEN** server 返回镜像内 `static/cli/versions.json` 内容

#### Scenario: 容器内下载 CLI 二进制

- **WHEN** 容器内 server 收到有效鉴权的 `GET /api/cli/download?os={os}&arch={arch}`
- **THEN** server 返回镜像内对应平台的 CLI 二进制文件
