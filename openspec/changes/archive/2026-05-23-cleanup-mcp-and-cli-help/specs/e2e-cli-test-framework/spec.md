## ADDED Requirements

### Requirement: 安全与授权边界测试

E2E 测试 SHALL 覆盖安全注入防御和授权边界场景，包括 SQL 注入、XSS、非 owner 操作拦截和上传限制。

#### Scenario: CRUD filter SQL 注入被安全处理
- **WHEN** 对 CRUD 列表接口传入恶意 filter 参数（如 `?done=1; DROP TABLE todos--`）
- **THEN** 返回正常结果或空列表，数据表未被破坏

#### Scenario: 上传 HTML 含 XSS 脚本时 CSP 生效
- **WHEN** 上传包含 `<script>alert('xss')</script>` 的 index.html
- **THEN** 静态文件服务返回的响应包含 CSP header（限制 script-src），页面内容原样返回（由浏览器执行 CSP 策略）

#### Scenario: 非 owner PUT 其他用户页面返回 403
- **WHEN** 用户 A 尝试 PUT /api/pages/:name 修改属于用户 B 的页面
- **THEN** 返回 403 Forbidden

#### Scenario: 非 owner DELETE 其他用户页面返回 403
- **WHEN** 用户 A 尝试 DELETE /api/pages/:name 删除属于用户 B 的页面
- **THEN** 返回 403 Forbidden

#### Scenario: 页面级 acl 模式拒绝非列表用户
- **WHEN** 页面设置为 `pageAccess.level = "acl"` 且 acl 列表包含用户 A，用户 B 尝试访问该页面
- **THEN** 返回 403 Forbidden

#### Scenario: 页面级 acl 模式允许列表内用户
- **WHEN** 页面设置为 `pageAccess.level = "acl"` 且 acl 列表包含用户 A，用户 A 尝试访问该页面
- **THEN** 返回 200 成功

### Requirement: 上传限制边界测试

E2E 测试 SHALL 覆盖上传限制的边界条件，确保超限请求被正确拒绝。

#### Scenario: 单次上传超过 50MB 返回 413
- **WHEN** 上传文件总大小超过 50MB
- **THEN** 返回 413 Payload Too Large

#### Scenario: POST /api/pages 缺少 name 返回 400
- **WHEN** POST /api/pages 请求体为空 JSON `{}`
- **THEN** 返回 400 Bad Request

#### Scenario: GET /api/schemas 缺少 pageName 返回 400
- **WHEN** GET /api/schemas 不携带 pageName 参数
- **THEN** 返回 400 Bad Request

#### Scenario: DELETE /api/schemas/:name 缺少 pageName 返回 400
- **WHEN** DELETE /api/schemas/todos 不携带 pageName 参数
- **THEN** 返回 400 Bad Request

#### Scenario: POST /api/schemas 缺少 fields 返回错误
- **WHEN** POST /api/schemas 只传 name 和 pageName，不传 fields
- **THEN** 返回错误响应（400 或 500）
