## ADDED Requirements

### Requirement: SDK 方法必须有服务端契约

`LocalAppClient` 暴露的每个公开方法 SHALL 对应一个开发态和生产态均可用的服务端契约。SDK 测试 SHALL 验证请求路径，运行时契约测试 SHALL 验证 mini-server 与生产 serve 至少覆盖同一组应用 API。

#### Scenario: count 方法有 dev/prod 端点
- **WHEN** 应用调用 `client.count("posts")`
- **THEN** SDK SHALL 请求 `{basePath}/posts/count`
- **AND** mini-server 和生产 serve SHALL 均支持该路径

#### Scenario: upload 方法使用内容 API
- **WHEN** 应用调用 `client.upload(file)`
- **THEN** SDK SHALL 请求 `{basePath}/content/upload`
- **AND** mini-server 和生产 serve SHALL 均支持该路径

#### Scenario: me 方法解析标准响应
- **WHEN** 应用调用 `client.me()`
- **THEN** SDK SHALL 解析 `{ success: true, data: User | null }`
- **AND** 不得依赖开发态裸对象响应

### Requirement: SDK count 兼容旧运行时

SDK `count()` MAY 在检测到旧运行时不支持 `/count` 时降级到 `list(resource, { limit: 1, filters })` 并读取 `pagination.total`。该降级 SHALL 只用于兼容旧运行时，不得作为新运行时的主要实现。

#### Scenario: 新运行时直接使用 count
- **WHEN** `/api/posts/count` 返回 200
- **THEN** `client.count("posts")` SHALL 返回响应中的 `data.count`
- **AND** 不得再发起额外 `list(limit: 1)` 请求

#### Scenario: 旧运行时降级
- **WHEN** `/api/posts/count` 返回 404 或明确的未支持错误
- **THEN** `client.count("posts")` MAY 请求 `/api/posts?limit=1`
- **AND** 返回列表响应中的 `pagination.total`

#### Scenario: 权限错误不降级
- **WHEN** `/api/posts/count` 返回 401 或 403
- **THEN** `client.count("posts")` SHALL 抛出 `LocalAppError`
- **AND** 不得用 list 降级绕过权限错误
