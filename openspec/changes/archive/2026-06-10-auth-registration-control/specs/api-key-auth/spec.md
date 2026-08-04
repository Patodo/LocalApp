## ADDED Requirements

### Requirement: 注册时生成 API Key

当 `POST /api/auth/register` 通过 `X-Registration-Key` 认证成功注册时，系统 SHALL 额外为新用户生成 API Key 并在响应中返回。该 API Key 与通过 `POST /api/keys` 创建的 Key 行为一致。

#### Scenario: CLI 静默注册返回 API Key
- **WHEN** 通过 `X-Registration-Key` 成功注册用户 `zhangsan`
- **THEN** 响应中包含 `apiKey` 字段，值为生成的 48 字符 hex API Key，该 Key 存储在 `api_keys` 表中并映射到 `zhangsan`

#### Scenario: 浏览器注册不返回 API Key
- **WHEN** 通过普通注册（无 `X-Registration-Key`）成功注册用户
- **THEN** 响应中不包含 `apiKey` 字段（现有行为不变）
