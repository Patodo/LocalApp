## MODIFIED Requirements

### Requirement: 页面 iframe 包装

`GET /{userId}/{name}` SHALL 返回一个 HTML 页面，内嵌 sandbox iframe 指向 `/serve/{userId}/{name}/`。

#### Scenario: 访问已存在的页面
- **WHEN** 请求 `GET /user1/my-cool-app` 且该页面存在
- **THEN** 返回 HTML 页面，包含 `<iframe sandbox="allow-scripts allow-forms allow-same-origin" src="/serve/user1/my-cool-app/">` 标签，iframe 占满视口

#### Scenario: 访问不存在的页面
- **WHEN** 请求 `GET /user1/nonexistent`
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 静态文件服务

`GET /serve/{userId}/{name}/*` SHALL 从最新版本目录提供文件，并设置 CSP 头。

#### Scenario: 请求存在的静态文件
- **WHEN** 请求 `GET /serve/user1/my-cool-app/assets/style.css`
- **THEN** 返回文件内容，设置正确的 MIME 类型和 CSP 头

#### Scenario: 请求 index.html
- **WHEN** 请求 `GET /serve/user1/my-cool-app/` 或 `GET /serve/user1/my-cool-app/index.html`
- **THEN** 返回最新版本的 `index.html`

### Requirement: SPA Fallback

当请求的路径没有对应文件时，SHALL 返回 `index.html`，以支持 SPA 客户端路由。

#### Scenario: SPA 子路由
- **WHEN** 请求 `GET /serve/user1/my-cool-app/about`，但文件系统中不存在 `about` 文件
- **THEN** 返回 `index.html`，由前端路由处理

#### Scenario: 静态资源不受影响
- **WHEN** 请求 `GET /serve/user1/my-cool-app/assets/app.js`，文件存在
- **THEN** 返回 `app.js` 文件本身，不 fallback

### Requirement: 安全头设置

页面服务 MUST 设置以下安全头：

#### Scenario: CSP 头
- **WHEN** 返回任何页面内容
- **THEN** 设置 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`

### Requirement: 页面 iframe 包装端到端验证

测试 SHALL 通过完整链路验证 iframe wrapper 页面的渲染。

#### Scenario: 访问已存在页面的 iframe HTML
- **WHEN** 通过 CLI 创建页面并上传包含 `index.html` 的文件后，请求 `GET /{userId}/{name}`
- **THEN** 返回 HTML，包含 `<iframe sandbox="allow-scripts allow-forms allow-same-origin" src="/serve/{userId}/{name}/">`

#### Scenario: 访问不存在页面
- **WHEN** 请求 `GET /{userId}/nonexistent`
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 静态文件服务端到端验证

测试 SHALL 验证通过 CLI 上传的文件能被正确服务。

#### Scenario: 请求 index.html（无尾部路径）
- **WHEN** 通过 CLI 上传 `index.html` 后，请求 `GET /serve/{userId}/{name}`
- **THEN** 返回 `index.html` 内容，MIME 类型为 `text/html`

#### Scenario: 请求 index.html（带尾部斜杠）
- **WHEN** 请求 `GET /serve/{userId}/{name}/`
- **THEN** 返回 `index.html` 内容

#### Scenario: 请求子目录中的静态文件
- **WHEN** 通过 CLI 上传 `assets/style.css` 后，请求 `GET /serve/{userId}/{name}/assets/style.css`
- **THEN** 返回 CSS 文件内容，MIME 类型为 `text/css`

#### Scenario: 请求不存在的文件
- **WHEN** 请求 `GET /serve/{userId}/{name}/nonexistent.js`
- **THEN** 返回 HTTP 404

### Requirement: SPA Fallback 端到端验证

e2e 测试 SHALL 验证 SPA fallback 在无扩展名路径时返回 index.html。

#### Scenario: SPA 子路由回退到 index.html
- **WHEN** 请求 `GET /serve/{userId}/{name}/about`，文件系统中无 `about` 文件
- **THEN** 返回 `index.html` 内容（无扩展名的路径触发 SPA fallback）

#### Scenario: 有扩展名的缺失文件不触发 fallback
- **WHEN** 请求 `GET /serve/{userId}/{name}/missing.js`
- **THEN** 返回 HTTP 404（有扩展名说明是明确的资源请求，不 fallback）

### Requirement: 安全头端到端验证

e2e 测试 SHALL 验证所有页面响应包含正确的 CSP 安全头。

#### Scenario: CSP 头设置
- **WHEN** 请求任何页面内容（`/serve/{userId}/{name}/`）
- **THEN** 响应头包含 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`
