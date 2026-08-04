## ADDED Requirements

### Requirement: SDK detectBasePath + CRUD 全链路端到端验证
系统 SHALL 提供端到端测试验证 SDK 的 `detectBasePath()` 路径检测和 CRUD fetch 请求在真实浏览器和 Server 环境下全链路可用。

#### Scenario: SDK 在 /serve/{uid}/{name}/ 路径下正确检测 basePath
- **GIVEN** 通过 CLI init 创建应用并通过 CLI schemas create 创建 `items` 数据表
- **AND** 上传一个包含内联 SDK 逻辑的 HTML 页面（页面内执行 `detectBasePath()` 并将结果写入 DOM）
- **WHEN** Playwright 访问部署页面 URL `/serve/{userId}/{name}/`
- **THEN** 页面 DOM 中的 basePath 值为 `/serve/{userId}/{name}/api`

#### Scenario: SDK list 返回空数据
- **GIVEN** 同上环境，数据表为空
- **WHEN** 页面内执行 `fetch(basePath + '/items')`
- **THEN** 返回 status 200，body 中 `data` 为空数组

#### Scenario: SDK create + list 全链路
- **GIVEN** 同上环境
- **WHEN** 页面内先执行 `fetch(basePath + '/items', { method: 'POST', body: { title: 'hello' } })`，再执行 list
- **THEN** create 返回 status 201，list 返回包含新数据的数组，`data[0].title` 为 `"hello"`

### Requirement: 测试 HTML 构造与部署
测试 SHALL 构造包含内联 SDK 逻辑的 HTML 文件，通过 CLI upload 部署到 Server，然后用 Playwright 访问验证。

#### Scenario: 上传测试 HTML 后可访问
- **WHEN** 将内含 SDK fetch 逻辑的 HTML 写入 dist/index.html 并通过 CLI upload 部署
- **THEN** Playwright 访问页面 URL 返回 200，页面 DOM 中包含 SDK 执行结果
