## ADDED Requirements

### Requirement: AuthProvider 全局认证上下文

系统 SHALL 提供 `AuthProvider` React Context，挂载在 Next.js layout 层，向所有子组件暴露 `useAuthModals()` hook。hook SHALL 返回 `{ openLogin, openChangePassword, closeLogin, closeChangePassword }` 方法。

#### Scenario: 子组件触发登录弹窗
- **WHEN** 任意组件调用 `useAuthModals().openLogin()`
- **THEN** 页面弹出 LoginDialog 模态框
- **AND** 模态框显示在最顶层（z-index 50）

#### Scenario: 子组件触发修改密码弹窗（force 模式）
- **WHEN** 任意组件调用 `useAuthModals().openChangePassword({ mode: "force", userId: "alice" })`
- **THEN** 页面弹出 ChangePasswordDialog 模态框
- **AND** 弹窗标题为"修改密码"
- **AND** 弹窗副标题提示用户需要先设置新密码

#### Scenario: 子组件触发修改密码弹窗（profile 模式）
- **WHEN** 任意组件调用 `useAuthModals().openChangePassword({ mode: "profile" })`
- **THEN** 页面弹出 ChangePasswordDialog 模态框
- **AND** 弹窗标题为"修改密码"

### Requirement: LoginDialog 登录模态框

系统 SHALL 提供 `LoginDialog` 模态框组件，包含用户名、密码输入框和提交按钮。提交 SHALL 调用 `POST /api/auth/login`。登录成功后 SHALL 关闭弹窗并刷新当前页面用户状态。登录返回 `MUST_CHANGE_PASSWORD` 错误码时 SHALL 自动关闭登录弹窗并弹出 ChangePasswordDialog（force 模式）。弹窗 SHALL 显示错误信息。

#### Scenario: 登录成功
- **WHEN** 用户填写正确的用户名和密码并提交
- **THEN** 调用 `POST /api/auth/login`
- **THEN** 登录弹窗关闭
- **AND** 当前页面刷新用户状态（显示已登录界面）

#### Scenario: 登录失败显示错误
- **WHEN** 用户填写错误的凭据并提交
- **THEN** 弹窗内显示"用户名或密码错误"提示
- **AND** 弹窗保持打开

#### Scenario: 登录触发强制改密
- **WHEN** 用户登录返回 `MUST_CHANGE_PASSWORD` 错误码
- **THEN** 登录弹窗自动关闭
- **AND** 自动弹出 ChangePasswordDialog（force 模式，传入 userId）

#### Scenario: 点击遮罩或关闭按钮关闭弹窗
- **WHEN** 用户点击弹窗外的遮罩层或关闭按钮
- **THEN** 登录弹窗关闭

### Requirement: ChangePasswordDialog 修改密码模态框

系统 SHALL 提供 `ChangePasswordDialog` 模态框组件，包含旧密码、新密码、确认密码三个输入框。组件 SHALL 支持 `force` 和 `profile` 两种模式。`force` 模式 SHALL 调用 `POST /api/auth/force-change-password`，`profile` 模式 SHALL 调用 `PUT /api/me/password`。新密码 SHALL 不少于 6 个字符，确认密码 SHALL 与新密码一致。

#### Scenario: force 模式修改密码成功
- **WHEN** 用户在 force 模式下填写正确的旧密码和有效新密码并提交
- **THEN** 调用 `POST /api/auth/force-change-password` 携带 `{ userId, oldPassword, newPassword }`
- **AND** 服务端设置登录 cookie
- **AND** 弹窗关闭，页面刷新用户状态

#### Scenario: profile 模式修改密码成功
- **WHEN** 已登录用户在 profile 模式下填写正确的旧密码和有效新密码并提交
- **THEN** 调用 `PUT /api/me/password` 携带 `{ oldPassword, newPassword }`
- **AND** 弹窗关闭，显示"密码修改成功"提示

#### Scenario: 密码不一致提示
- **WHEN** 用户输入的新密码和确认密码不一致
- **THEN** 提交按钮禁用或在提交时显示"两次密码不一致"错误

#### Scenario: 新密码过短
- **WHEN** 用户输入的新密码少于 6 个字符
- **THEN** 提交按钮禁用或在提交时显示"密码至少 6 个字符"错误

#### Scenario: 旧密码错误
- **WHEN** 用户输入的旧密码不正确
- **THEN** 弹窗内显示服务端返回的错误信息

#### Scenario: force 模式不显示 userId 输入框
- **WHEN** ChangePasswordDialog 以 force 模式打开
- **THEN** userId 由调用方传入，不显示在表单中
