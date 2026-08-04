## MODIFIED Requirements

### Requirement: upload 接口接收并持久化 shell 配置
upload 路由 SHALL 接收 shell 配置并持久化到 meta.json。

#### Scenario: upload 请求包含 shellConfig 字段
- **WHEN** POST /api/upload 请求包含 `shellConfig` 字段（JSON string）
- **THEN** 服务端将 shellConfig 解析后保存到 meta.json 的 `shell` 字段

#### Scenario: upload 请求不包含 shellConfig
- **WHEN** POST /api/upload 请求不包含 `shellConfig` 字段
- **THEN** meta.json 的 `shell` 字段保持不变（不覆盖/不删除）

#### Scenario: CLI upload 读取 manifest.json 的 shell 配置
- **WHEN** 用户执行 `localapp upload`
- **THEN** CLI 读取 manifest.json 的 `shell` 字段（如果存在），作为 `shellConfig` 字段一起上传
