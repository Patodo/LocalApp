## ADDED Requirements

### Requirement: 服务器配置下发端点

服务器 SHALL 提供 `GET /api/config` 端点（需鉴权），返回 `templateRepoUrl` 和 `gitDownloadUrl`。

#### Scenario: 获取配置
- **WHEN** 发送 `GET /api/config`（携带有效 API Key）
- **THEN** 返回 `{"templateRepoUrl": "...", "gitDownloadUrl": "..." | null}`，HTTP 200

#### Scenario: 未鉴权
- **WHEN** 发送 `GET /api/config`（无 API Key 或无效 Key）
- **THEN** 返回 `{"error": "Unauthorized"}`，HTTP 401

### Requirement: TEMPLATE_REPO_URL 环境变量为必配项

服务器 SHALL 在启动时检查 `TEMPLATE_REPO_URL` 环境变量，未配置则拒绝启动。

#### Scenario: 未配置 TEMPLATE_REPO_URL
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 环境变量未设置或为空
- **THEN** 输出错误日志 `"TEMPLATE_REPO_URL is required. Server cannot start without it."`，进程退出

#### Scenario: 已配置 TEMPLATE_REPO_URL
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 已设置为有效 Git 仓库 URL
- **THEN** 正常启动，`/api/config` 返回该 URL

### Requirement: GIT_DOWNLOAD_URL 环境变量为可选配置

服务器 SHALL 支持 `GIT_DOWNLOAD_URL` 环境变量作为可选配置。未配置时 `/api/config` 返回 `gitDownloadUrl` 为 `null`。

#### Scenario: 配置了 GIT_DOWNLOAD_URL
- **WHEN** 服务器启动时 `GIT_DOWNLOAD_URL` 已设置
- **THEN** `/api/config` 返回 `{"templateRepoUrl": "...", "gitDownloadUrl": "<配置的URL>"}`

#### Scenario: 未配置 GIT_DOWNLOAD_URL
- **WHEN** 服务器启动时 `GIT_DOWNLOAD_URL` 未设置
- **THEN** `/api/config` 返回 `{"templateRepoUrl": "...", "gitDownloadUrl": null}`
