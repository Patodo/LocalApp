## MODIFIED Requirements

### Requirement: API Key 验证

所有管理接口 MUST 要求请求携带 `X-API-Key` header。服务器 SHALL 从 `meta.sqlite` 的 `api_keys` 表查询 key 对应的 userId。验证通过后，SHALL 执行 CLI 版本校验。API Key 认证与 session cookie 认证 SHALL 并行存在，分别服务于 CLI 访问和浏览器访问。

#### Scenario: 有效 API Key 请求
- **WHEN** 请求携带 `X-API-Key: valid-key-123` 且该 key 存在于 meta.sqlite
- **THEN** 请求通过验证，后续处理中可获取对应的 userId

#### Scenario: 缺少 API Key
- **WHEN** 请求未携带 `X-API-Key` header
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "API key required" }`

#### Scenario: 无效 API Key
- **WHEN** 请求携带 `X-API-Key: invalid-key` 且该 key 不存在于 meta.sqlite
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "Invalid API key" }`
