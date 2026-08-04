## MODIFIED Requirements

### Requirement: 根路径重定向

`GET /` SHALL 根据用户登录状态执行不同操作。已登录用户 SHALL 渲染首页组件（三模块布局）。未登录用户 SHALL 重定向到 `/login?redirect=/`。

#### Scenario: 已登录用户看到首页
- **WHEN** 携带有效 session cookie 请求 `GET /`
- **THEN** 渲染首页组件，显示"我的应用"、"收藏应用"、"最近访问"三个模块

#### Scenario: 未登录用户访问根路径
- **WHEN** 不携带 session cookie 请求 `GET /`
- **THEN** 重定向到 `/login?redirect=/`

#### Scenario: 登录后回到首页
- **WHEN** 用户在 `/login` 页面登录成功，redirect 参数为 `/`
- **THEN** 跳转到 `/`，渲染首页内容

## REMOVED Requirements

### Requirement: 登录页面视觉风格
**Reason**: 登录/注册/改密页面的视觉风格定义与首页路由无关，不随此变更修改
**Migration**: 保留在 openspec/specs/homepage-redirect/spec.md 中不修改

### Requirement: 注册页面视觉风格
**Reason**: 同上
**Migration**: 保留在 openspec/specs/homepage-redirect/spec.md 中不修改

### Requirement: 强制改密页面视觉风格
**Reason**: 同上
**Migration**: 保留在 openspec/specs/homepage-redirect/spec.md 中不修改

### Requirement: 应用外壳导航栏视觉风格
**Reason**: 同上
**Migration**: 保留在 openspec/specs/homepage-redirect/spec.md 中不修改
