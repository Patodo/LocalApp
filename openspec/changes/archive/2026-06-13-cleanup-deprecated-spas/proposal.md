## Why

`packages/admin/` 和 `packages/profile/` 两个旧 SPA 自 `80df8bb`（switch admin and profile to Next.js）起就被标记为 DEPRECATED，但实际上**仍然存在于仓库中**，且：

- `pnpm-workspace.yaml` 仍声明 `packages/admin`，`pnpm -r build` 会构建已废弃的代码
- `Dockerfile` 仍 `COPY packages/admin/package.json`，浪费镜像层
- root `package.json` 仍保留 `build:admin` / `build:profile` 两个 script
- 两份 `DEPRECATED.md` 文档**指向的路径已经不存在**（写的是 `web/app/(dashboard)/admin/`，实际是 `/my/`），反而误导后续贡献者

最直接的后果：`4053a8f feat(admin): 添加管理员创建用户功能到用户管理页面` 把功能加进了**不再被构建/服务**的旧 SPA，导致 UI 上看不到。保留这些代码就是在持续制造同类错误。

## What Changes

- **删除** `packages/admin/` 整个目录（包含 DEPRECATED.md、src/、构建配置）
- **删除** `packages/profile/` 整个目录（同上）
- **清理** `pnpm-workspace.yaml`：移除 `packages/admin` 引用
- **清理** root `package.json`：删除 `build:admin` 和 `build:profile` 两个 script
- **清理** `Dockerfile`：移除 `COPY packages/admin/package.json` 及相关行
- **补缺**：将"管理员创建用户"功能从旧 SPA `packages/admin/src/pages/Users.tsx` 迁移到 `packages/web/app/(dashboard)/my/users/page.tsx`，复用已存在的 `POST /api/admin/users` 端点（`fe7ac8b` 已实现）

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `monorepo-structure`: packages/ 下的 TypeScript 子包集合发生变化（移除 admin、profile），相应更新 workspace 声明和子包清单描述
- `admin-panel`: `/my/users` 页面新增"管理员创建用户"交互行为（弹窗表单 + 调用 `POST /api/admin/users`）

## Impact

**受影响代码**:
- 删除：`packages/admin/`（src/、index.html、vite.config.ts、tsconfig.json、package.json、DEPRECATED.md）
- 删除：`packages/profile/`（同构）
- 修改：`pnpm-workspace.yaml`、根 `package.json`、`Dockerfile`
- 修改：`packages/web/app/(dashboard)/my/users/page.tsx`（新增"创建用户"按钮和弹窗）

**不受影响**:
- API 层：`POST /api/admin/users` 已存在，本次不动 server
- 旧的 `user-profile-ui` spec 描述的 `/profile` 路径已是历史遗留，本次不扩范围清理，留给后续变更

**风险评估**:
- 全仓库无任何代码 `import` 旧 SPA（grep `@localapp/(admin|profile)` 零匹配）
- 删除后 git 历史仍可追溯，需要参考时 `git show` 即可
- 创建用户功能迁移后必须验证：成功创建用户、密码长度校验、错误提示
