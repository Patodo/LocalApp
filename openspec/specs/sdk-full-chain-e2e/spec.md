## Purpose

定义 SDK 在真实 `.localapp` 包、canonical Server、正式 Platform Shell 和 Named SQL API 上的全链路端到端验证。

## Requirements

### Requirement: SDK basePath 与 Named SQL 全链路验证

端到端测试 SHALL 从 builtin template 创建应用，声明 backend contract，构建 `.localapp`，通过 `/api/me/apps/install` 安装到干净 Server，并从正式 `/<owner>/<app>/` URL 使用真实浏览器验证 SDK。

#### Scenario: 正式 Shell 中检测应用 API basePath

- **GIVEN** 应用已安装到 `test-owner/sdk-app`
- **WHEN** Browser 访问 `/test-owner/sdk-app/`
- **THEN** Platform Shell SHALL 注入 `/serve/test-owner/sdk-app/` resource base
- **AND** SDK SHALL 将应用 API basePath 解析为 `/serve/test-owner/sdk-app/api`

#### Scenario: named query 返回列表

- **GIVEN** 应用声明 `$items.list` named query 且数据为空
- **WHEN** 页面调用 `client.list("items")`
- **THEN** SDK SHALL 请求 named query endpoint
- **AND** 页面 SHALL 显示空列表且 console 无错误

#### Scenario: named mutation 后刷新列表

- **GIVEN** 应用声明 `$items.create` 和 `$items.list`
- **WHEN** 页面创建 title 为 `hello` 的记录并刷新
- **THEN** mutation SHALL 返回成功结果
- **AND** 列表 SHALL 包含新记录

### Requirement: 开发与正式安装使用同一 Server 契约

同一应用 SHALL 分别通过 `localapp dev` 和正式包安装运行。除 Vite 编译与代理外，两者 SHALL 使用同一 Server 路由、backend contract、身份与内容 API；测试不得使用 REST CRUD fallback 或 raw route 作为用户体验入口。

#### Scenario: dev 与正式 API 一致

- **WHEN** 测试在开发页和正式页执行同一组 named query、mutation、identity 和 content 操作
- **THEN** 两边 SHALL 返回相同响应形态和权限结果
- **AND** 不得启动模板自带 HTTP 服务
