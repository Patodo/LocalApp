## Context

当前认证流程以独立页面形式实现：`/login`、`/register`、`/force-change-password` 三个路由各有独立的页面文件，用户操作时必须离开当前上下文。首页 (`PublicHome`) 中有一个手写的 inline 登录弹窗（~70 行 JSX），项目没有可复用的 Dialog 组件。个人资料页有一个独立的 inline 修改密码表单。三处密码修改逻辑各自实现，没有共享。

服务端 API 层已有 `allow_register` 配置（默认 `false`），但前端不读取此配置，始终显示注册入口。Admin 面板有用户列表、删除、重置密码功能，但没有创建用户的能力。

## Goals / Non-Goals

**Goals:**
- 移除所有独立认证页面，登录和修改密码统一为全局模态框
- 通过 AuthProvider Context 实现任意组件可触发认证弹窗
- Admin 面板支持创建用户（仅需用户名）
- 移除所有浏览器端注册入口

**Non-Goals:**
- 不修改服务端认证 API 的核心逻辑（register/login/logout/force-change-password 端点保持不变）
- 不修改 CLI 注册流程
- 不引入第三方 Dialog 组件库（使用项目现有的手写 overlay 模式，与首页现有实现一致）
- 不做注册功能的"开关化"（前端不读 `allow_register` 配置，直接移除注册入口）

## Decisions

### 1. AuthProvider 使用 React Context + useState

在 `packages/web/app/layout.tsx` 中挂载 `AuthProvider`，通过 `useAuthModals()` hook 暴露 `openLogin()` 和 `openChangePassword({ mode })` 方法。

**方案**: Context + Provider（而非 zustand/jotai 等状态库）
**理由**: 项目前端未引入状态管理库，Context 方式零依赖，与项目风格一致。认证弹窗的状态极简（两个 boolean + 少量参数），不需要复杂状态管理。

### 2. 模态框挂载在 layout 层

`LoginDialog` 和 `ChangePasswordDialog` 作为 `AuthProvider` 内部的子组件渲染，跟随 Provider 挂载在 layout 层。所有页面和组件共享同一个实例。

**理由**: 单实例避免重复渲染，且保证弹窗在最顶层（z-index 不冲突）。

### 3. ChangePasswordDialog 支持两种模式

| 模式 | 触发场景 | API | 认证方式 |
|------|----------|-----|----------|
| `force` | 登录返回 `MUST_CHANGE_PASSWORD` | `POST /api/auth/force-change-password` | `{ userId, oldPassword, newPassword }` |
| `profile` | 用户主动修改密码 | `PUT /api/me/password` | Cookie 自动携带 |

**理由**: 两个 API 的入参和认证方式不同，但 UI 表单（旧密码、新密码、确认密码）高度一致。统一组件通过 mode 切换 API 调用，避免 UI 发散。

### 4. Admin 创建用户 API 复用现有模式

新增 `POST /api/admin/users`，body 仅 `{ username }`。服务端逻辑复用 CLI 注册的路径：密码默认 `localapp`，设置 `mustChangePassword=true`，但不需要 `registrationKey` 验证（因为是 admin 权限）。

**理由**: 与 CLI 注册行为一致，用户首次登录都会触发强制改密。

### 5. 使用手写 overlay 模式而非引入 Dialog 组件

模态框实现沿用首页现有的 `fixed inset-0 z-50` + `bg-black/35 backdrop-blur-md` 模式，不引入 shadcn Dialog。

**理由**: 保持与现有首页弹窗风格一致，零新增依赖。

## Risks / Trade-offs

- **[Risk] 移除 `/login` 页面后，直接访问 `/login` URL 会 404** → serve.ts 中移除路由后，Next.js 的 `next export` 也不会生成对应 HTML。如果用户有书签或外部链接指向 `/login`，会看到 404。可接受的 trade-off，因为 `/login` 是内部页面，无外部链接依赖。
- **[Risk] AuthProvider 需要在所有需要登录的页面之上** → 确保 Provider 挂在 `app/layout.tsx`，这是 Next.js App Router 的最顶层布局，所有页面都在其下。
- **[Risk] `app-shell.tsx` 和 `platform-shell.tsx` 中的 401 跳转逻辑需要改为弹窗** → 这些是客户端组件，可以使用 `useAuthModals()` hook。但需要确保这些组件在 AuthProvider 内部渲染。
