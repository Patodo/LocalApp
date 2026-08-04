## MODIFIED Requirements

### Requirement: CLI release 产物落盘

项目 SHALL 提供一个本地发布步骤，将 `cargo build --release` 生成的当前平台 CLI 二进制复制到 `packages/server/static/cli/{version}/`，文件名 MUST 与 server 下载接口使用的平台命名保持一致。下载接口 `/api/cli/download` MUST 设置 `Content-Disposition: attachment; filename="<filename>"` header，其中 filename 根据请求的 `os` 参数决定：`windows` → `localapp.exe`，其他平台 → `localapp`。

#### Scenario: Windows 下载获得正确文件名
- **WHEN** 用户请求 `GET /api/cli/download?os=windows&arch=x86_64`
- **THEN** 响应包含 `Content-Disposition: attachment; filename="localapp.exe"`

#### Scenario: Linux 下载获得正确文件名
- **WHEN** 用户请求 `GET /api/cli/download?os=linux&arch=x86_64`
- **THEN** 响应包含 `Content-Disposition: attachment; filename="localapp"`

#### Scenario: macOS ARM 下载获得正确文件名
- **WHEN** 用户请求 `GET /api/cli/download?os=macos&arch=aarch64`
- **THEN** 响应包含 `Content-Disposition: attachment; filename="localapp"`
