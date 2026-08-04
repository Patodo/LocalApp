## MODIFIED Requirements

### Requirement: Navbar 组件

导航栏 SHALL 分为左右两个区域。左侧 SHALL 包含 Home 按钮（House 图标，链接到 `/`）、应用名称和 Issue 按钮。右侧 SHALL 包含收藏按钮（星标图标 + 收藏数量）、头像（已登录时）或登录按钮（未登录时）。未登录时点击登录按钮 SHALL 弹出全局 LoginDialog 模态框，不再跳转到 `/login` 页面。导航栏 SHALL NOT 显示注册按钮。

#### Scenario: Home 按钮可见且功能正常
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏最左侧显示 House 图标按钮
- **THEN** 点击 Home 按钮跳转到 `/`

#### Scenario: Issue 按钮可见
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏左侧显示 CircleDot 图标按钮（在 Home 按钮和应用名称之后）
- **THEN** 点击打开 Issue 模态框

#### Scenario: 收藏按钮显示星标数量
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏右侧显示星标图标 + 收藏数量
- **THEN** 点击收藏按钮切换收藏状态

#### Scenario: 未登录用户点击登录弹出模态框
- **WHEN** 未登录用户点击导航栏登录按钮
- **THEN** 弹出 LoginDialog 模态框（而非跳转到 `/login` 页面）

#### Scenario: 导航栏不显示注册按钮
- **WHEN** 未登录用户查看导航栏
- **THEN** 导航栏仅显示登录按钮，不显示注册按钮

### Requirement: PlatformShell 组件

`PlatformShell` React 组件 SHALL 渲染应用的 iframe 外壳。组件 SHALL 从 URL params 获取 `userId` 和 `name`，从 `/api/me` 获取当前用户信息。未登录用户点击登录 SHALL 弹出 LoginDialog 模态框，不再跳转到 `/login` 页面。

#### Scenario: 未登录用户看到登录按钮
- **WHEN** 未登录用户访问平台外壳
- **THEN** 导航栏右侧显示登录按钮
- **THEN** 点击登录弹出 LoginDialog 模态框

## REMOVED Requirements

### Requirement: 未登录用户点击登录跳转到 /login 页面
**Reason**: 登录功能由全局 LoginDialog 模态框替代，不再需要页面跳转
**Migration**: 未登录时的 `router.push("/login?redirect=...")` 改为调用 `useAuthModals().openLogin()`
