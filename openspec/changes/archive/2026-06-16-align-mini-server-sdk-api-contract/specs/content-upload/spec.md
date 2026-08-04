## ADDED Requirements

### Requirement: 应用内容 API 在 dev/prod 路径一致

应用侧文件上传 SHALL 使用 `{basePath}/content/upload`，文件读取 SHALL 使用上传结果中的 `url`。生产 serve 与 mini-server SHALL 均支持该路径。旧的 mini-server `/api/upload` MAY 作为兼容别名保留，但文档和 SDK SHALL 推荐内容 API 路径。

#### Scenario: dev 上传路径与 SDK 一致
- **WHEN** dev 应用通过 SDK 上传文件
- **THEN** 请求路径 SHALL 为 `/api/content/upload`
- **AND** mini-server SHALL 返回 `{ success: true, data: { key, url } }`

#### Scenario: prod 上传路径与 SDK 一致
- **WHEN** 生产应用通过 SDK 上传文件
- **THEN** 请求路径 SHALL 为 `/serve/{userId}/{pageName}/api/content/upload`
- **AND** 生产 serve SHALL 返回 `{ success: true, data: { key, url } }`

#### Scenario: 上传结果可直接展示
- **WHEN** 应用将上传结果的 `url` 用作图片或下载链接
- **THEN** dev 和 prod SHALL 都能通过该 URL 读取文件
