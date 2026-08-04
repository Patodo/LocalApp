## ADDED Requirements

### Requirement: CLI 版本校验

Auth hook 在 API Key 验证通过后 SHALL 检查 `X-CLI-Version` header。若 header 缺失或版本号低于 `MIN_CLI_VERSION` 环境变量指定的值，MUST 返回 HTTP 403。`/api/cli/version` 和 `/api/cli/download` 路径 MUST 跳过版本检查。

#### Scenario: 版本满足最低要求
- **WHEN** 请求携带 `X-CLI-Version: 0.2.0` 且 `MIN_CLI_VERSION=0.1.0`
- **THEN** 版本检查通过，请求正常处理

#### Scenario: 版本低于最低要求
- **WHEN** 请求携带 `X-CLI-Version: 0.1.0` 且 `MIN_CLI_VERSION=0.2.0`
- **THEN** 返回 HTTP 403，响应体包含错误信息提示执行 `localapp update`

#### Scenario: 缺失版本 header
- **WHEN** 请求未携带 `X-CLI-Version` header 且 `MIN_CLI_VERSION` 已设置
- **THEN** 返回 HTTP 403，响应体包含 `"CLI version unknown"` 提示更新

#### Scenario: 未配置最低版本
- **WHEN** `MIN_CLI_VERSION` 环境变量未设置或为空字符串
- **THEN** 跳过版本检查，所有请求放行

#### Scenario: Update 端点绕过
- **WHEN** 请求路径为 `/api/cli/version` 或 `/api/cli/download`
- **THEN** 跳过版本检查，仅做 API Key 验证

## MODIFIED Requirements

### Requirement: API Key 验证

所有管理接口 MUST 要求请求携带 `X-API-Key` header。服务器 SHALL 从 `meta.sqlite` 的 `api_keys` 表查询 key 对应的 userId。验证通过后，SHALL 执行 CLI 版本校验。

#### Scenario: 有效 API Key 请求
- **WHEN** 请求携带 `X-API-Key: valid-key-123` 且该 key 存在于 meta.sqlite
- **THEN** 请求通过验证，后续处理中可获取对应的 userId

#### Scenario: 缺少 API Key
- **WHEN** 请求未携带 `X-API-Key` header
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "API key required" }`

#### Scenario: 无效 API Key
- **WHEN** 请求携带 `X-API-Key: invalid-key` 且该 key 不存在于 meta.sqlite
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "Invalid API key" }`
