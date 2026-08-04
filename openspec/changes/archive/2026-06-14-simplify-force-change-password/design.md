## Context

当前首次登录强制改密流程存在 UX 冗余：

```
LoginDialog 输入 username + 默认密码
       │
       ▼  (服务端验密码通过，但因 must_change_password 拒发 token)
   403 MUST_CHANGE_PASSWORD
       │
       ▼
ChangePasswordDialog (force)
   - 当前密码  ← 又要再输一遍（与刚才 LoginDialog 输入的是同一个值）
   - 新密码
   - 确认新密码
```

服务端 `POST /api/auth/force-change-password` 是**公开端点**（不带 token），靠 `oldPassword` + bcrypt 比对来证明身份。这是当前架构下身份证明的必要手段——但前端**完全可以在用户刚刚输入完毕的瞬间把这个值缓存住**，不需要用户再敲一遍。

相关文件：
- `packages/web/components/auth-modals/auth-provider.tsx`：AuthProvider Context
- `packages/web/components/auth-modals/login-dialog.tsx`：登录弹窗
- `packages/web/components/auth-modals/change-password-dialog.tsx`：改密弹窗
- `packages/server/src/routes/auth.ts:86-119`：force-change-password 端点

## Goals / Non-Goals

**Goals:**
- force 模式下用户不再被要求重复输入"当前密码"
- 服务端 API 契约保持稳定（端点签名、参数、行为完全不变）
- profile 模式行为完全不变（仍要求用户主动输入当前密码作为二次校验）

**Non-Goals:**
- 不重构服务端鉴权体系（不引入"受限 token"或"短时票据"机制）
- 不修复用户报告的"两次新密码不一致会关闭模态框"问题（与本次变更无关，需要另行确认是否为真 bug）
- 不调整密码强度策略、长度限制等业务规则
- 不处理"刷新页面后继续 force 改密"场景（接受该路径自然失败，用户需重新登录）

## Decisions

### Decision 1: 保留服务端端点签名不变

**选择**：`POST /api/auth/force-change-password` 继续接受 `{ userId, oldPassword, newPassword }`，前端把缓存的 password 作为 `oldPassword` 发送。

**理由**：
- `password-reset` 主规格已明确把 `oldPassword` 写进端点契约，改签名会触发 spec 修改和回归测试
- 服务端继续做 bcrypt 比对，等于是双层保险：前端缓存 + 服务端验证
- blast radius 最小：本次只动 3 个前端文件

**备选（已否决）**：
- 改端点签名为 `{ userId, newPassword }`，服务端不再验旧密码 → 安全性下降（任何人知道 userId 就能改密），且需要新增身份证明机制（短时票据 / 受限 token），架构改动过大
- 引入"登录即发受限 token，force-change 用 token 鉴权" → 最干净但需要 JWT scope 体系，项目当前没有，属于过度设计

### Decision 2: password 暂存在 AuthProvider 内存 state 中

**选择**：在 AuthProvider 新增 `pendingOldPassword: string | null` state 和配套 setter；LoginDialog 在 MUST_CHANGE_PASSWORD 分支调用 setter；ChangePasswordDialog force 模式从 context 读取并提交；提交成功后清空。

**理由**：
- AuthProvider 已经是登录/改密弹窗状态的所有者，新增一个字段符合既有架构
- React state 只在内存中，刷新页面即丢失——这正好是我们想要的生命周期（短窗口内有效）
- 不污染 localStorage / sessionStorage / URL，避免密码持久化或泄露

**备选（已否决）**：
- sessionStorage → 刷新后仍存在，扩大密码暴露窗口
- URL query param → 密码出现在地址栏 / 浏览器历史 / 日志，绝对不可接受
- LoginDialog 不卸载、直接把 password 作为 prop 传给 ChangePasswordDialog → 需要让两个 dialog 同时挂载，违反当前"互斥弹窗"模式

### Decision 3: force 模式条件渲染"当前密码"输入框

**选择**：`{!isForce && <OldPasswordField />}`，profile 模式照常显示，force 模式隐藏。

**理由**：
- 复用同一个 dialog 组件，避免拆出两个组件
- profile 模式没有"刚登录"的上下文，仍需要用户主动证明知道旧密码

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| password 在 React state 停留时间变长（从登录提交到改密提交） | 中等。密码管理器/内存 dump 可能截到值 | 改密成功后立即清空；不持久化；正常流程下窗口仅几秒 |
| 用户在 force 弹窗打开后刷新页面 | password 丢失，提交时 oldPassword 为空，服务端 401 | 显示错误"凭据无效，请重新登录"；用户回到 LoginDialog 重走流程即可（合理行为，文档化即可） |
| 直接通过 DevTools 调用 `openChangePassword({ mode: "force" })` 而无登录前置 | oldPassword 为 null，提交失败 | 接受。force 模式的合法入口只有 LoginDialog 的 MUST_CHANGE_PASSWORD 分支 |
| 服务端日志/请求监控会记录到 oldPassword | 已存在的风险，本次变更不加剧 | 端点契约不变，请求体格式不变，已有的脱敏策略继续生效 |

## Migration Plan

- 纯前端变更，无数据库迁移、无配置变更
- 部署顺序：先发前端，后端不动 → 兼容
- 回滚：还原 3 个前端文件即可，无副作用

## Open Questions

无。所有决策在 explore 阶段已和用户对齐。
