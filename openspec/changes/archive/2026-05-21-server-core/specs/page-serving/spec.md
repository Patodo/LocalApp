## ADDED Requirements

### Requirement: 页面 iframe 包装

`GET /{userId}/{pageId}` SHALL 返回一个 HTML 页面，内嵌 sandbox iframe 指向 `/serve/{userId}/{pageId}/`。

#### Scenario: 访问已存在的页面
- **WHEN** 请求 `GET /user1/abc123` 且该页面存在
- **THEN** 返回 HTML 页面，包含 `<iframe sandbox="allow-scripts allow-forms" src="/serve/user1/abc123/">` 标签，iframe 占满视口

#### Scenario: 访问不存在的页面
- **WHEN** 请求 `GET /user1/nonexistent`
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 静态文件服务

`GET /serve/{userId}/{pageId}/*` SHALL 从最新版本目录提供文件，并设置 CSP 头。

#### Scenario: 请求存在的静态文件
- **WHEN** 请求 `GET /serve/user1/abc123/assets/style.css`
- **THEN** 从 `data/user1/abc123/versions/v{latest}/assets/style.css` 返回文件，设置正确的 MIME 类型和 CSP 头

#### Scenario: 请求 index.html
- **WHEN** 请求 `GET /serve/user1/abc123/` 或 `GET /serve/user1/abc123/index.html`
- **THEN** 返回最新版本的 `index.html`

### Requirement: SPA Fallback

当请求的路径没有对应文件时，SHALL 返回 `index.html`，以支持 SPA 客户端路由。

#### Scenario: SPA 子路由
- **WHEN** 请求 `GET /serve/user1/abc123/about`，但文件系统中不存在 `about` 文件
- **THEN** 返回 `index.html`，由前端路由处理

#### Scenario: 静态资源不受影响
- **WHEN** 请求 `GET /serve/user1/abc123/assets/app.js`，文件存在
- **THEN** 返回 `app.js` 文件本身，不 fallback

### Requirement: 安全头设置

页面服务 MUST 设置以下安全头：

#### Scenario: CSP 头
- **WHEN** 返回任何页面内容
- **THEN** 设置 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`
