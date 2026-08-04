## ADDED Requirements

### Requirement: 页面 iframe 包装端到端验证

测试 SHALL 通过完整链路验证 iframe wrapper 页面的渲染。

#### Scenario: 访问已存在页面的 iframe HTML
- **WHEN** 通过 CLI 创建页面并上传包含 `index.html` 的文件后，请求 `GET /{userId}/{pageId}`
- **THEN** 返回 HTML，包含 `<iframe sandbox="allow-scripts allow-forms allow-same-origin" src="/serve/{userId}/{pageId}/">`

#### Scenario: 访问不存在页面
- **WHEN** 请求 `GET /{userId}/nonexistent`
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 静态文件服务端到端验证

测试 SHALL 验证通过 CLI 上传的文件能被正确服务。

#### Scenario: 请求 index.html（无尾部路径）
- **WHEN** 通过 CLI 上传 `index.html` 后，请求 `GET /serve/{userId}/{pageId}`
- **THEN** 返回 `index.html` 内容，MIME 类型为 `text/html`

#### Scenario: 请求 index.html（带尾部斜杠）
- **WHEN** 请求 `GET /serve/{userId}/{pageId}/`
- **THEN** 返回 `index.html` 内容

#### Scenario: 请求子目录中的静态文件
- **WHEN** 通过 CLI 上传 `assets/style.css` 后，请求 `GET /serve/{userId}/{pageId}/assets/style.css`
- **THEN** 返回 CSS 文件内容，MIME 类型为 `text/css`

#### Scenario: 请求不存在的文件
- **WHEN** 请求 `GET /serve/{userId}/{pageId}/nonexistent.js`
- **THEN** 返回 HTTP 404

### Requirement: SPA Fallback 端到端验证

#### Scenario: SPA 子路由回退到 index.html
- **WHEN** 请求 `GET /serve/{userId}/{pageId}/about`，文件系统中无 `about` 文件
- **THEN** 返回 `index.html` 内容（无扩展名的路径触发 SPA fallback）

#### Scenario: 有扩展名的缺失文件不触发 fallback
- **WHEN** 请求 `GET /serve/{userId}/{pageId}/missing.js`
- **THEN** 返回 HTTP 404（有扩展名说明是明确的资源请求，不 fallback）

### Requirement: 安全头端到端验证

#### Scenario: CSP 头设置
- **WHEN** 请求任何页面内容（`/serve/{userId}/{pageId}/`）
- **THEN** 响应头包含 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`
