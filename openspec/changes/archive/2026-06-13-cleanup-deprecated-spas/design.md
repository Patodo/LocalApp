## Context

LocalApp monorepo 历史上经历过两次重大前端架构变更：

1. `80df8bb`（switch admin and profile to Next.js, deprecate old SPAs）——把 `packages/admin/` 和 `packages/profile/` 两个 Vite + React SPA 的功能整体迁移到了 `packages/web/`（Next.js App Router）。这次变更只是给旧 SPA 加了 DEPRECATED.md，没有删除代码。
2. `02c4140`（统一 dashboard 路由到 /my/*）——把 web 的 admin/profile 路由统一到 `/my/*` 下。

之后又陆续有 `4053a8f`（管理员创建用户）等功能错误地写进了旧 SPA，直接导致 UI 看不到这些功能。这是"代码保留但不再构建"这种半状态带来的典型后果。

当前状态：
- `packages/admin/` 和 `packages/profile/` 仍占空间，pnpm-workspace.yaml 列了 admin（profile 漏列）
- root package.json 有 `build:admin`、`build:profile` 两个 script
- Dockerfile 仍 COPY `packages/admin/package.json`
- 两份 DEPRECATED.md 描述的迁移目标路径已不存在（写的是 `web/app/(dashboard)/admin/`，实际是 `/my/`）
- 全仓库 grep `@localapp/(admin|profile)` 零匹配，确认无代码依赖

## Goals / Non-Goals

**Goals:**
- 让工作树只反映"当前生效"的代码——废弃的 SPA 物理删除
- 同步清理 pnpm-workspace.yaml、root package.json scripts、Dockerfile 中所有对废弃包的引用
- 补齐"管理员创建用户"功能到 `packages/web/app/(dashboard)/my/users/page.tsx`（API 已存在）

**Non-Goals:**
- 不重构或调整 `packages/web/` 的现有 UI 结构
- 不修改 server 端代码（API `POST /api/admin/users` 已实现）
- 不清理过时的 `user-profile-ui` spec（描述 `/profile` 旧路径），留给后续变更
- 不动 root tsconfig.json 的 references 配置（admin/profile 本就不在 references 列表中）

## Decisions

### Decision 1: 物理删除而非保留 + 标记

**选择**：直接 `git rm -r packages/admin packages/profile`，包括 DEPRECATED.md。

**理由**：
- git 历史已经提供完整可追溯性，"保留作参考"在 monorepo 中几乎从不发生
- DEPRECATED.md 描述的路径已不存在，**保留它本身就是在制造错误信息**
- 半状态（标记废弃但代码还在）让 grep、AI 辅助、构建系统都难以区分"活的"vs"死的"代码

**Alternatives**:
- (a) 保留代码 + 修正 DEPRECATED.md：歧义根源没解决，未来仍可能误改
- (b) 移到 `archive/` 或 `.archive/` 目录：还是占空间、还是会被搜索到，没有真正好处

### Decision 2: 创建用户功能 — 弹窗而非整页表单

**选择**：在 `/my/users` 页面顶部新增"创建用户"按钮，点击弹出模态框（用户名输入 + 提交/取消）。

**理由**：
- 创建用户是低频操作，弹窗比新页面/新路由更轻
- 与现有 UI 模式一致——`force-change-password`、`reset-password` 确认等都是弹窗/toast 风格
- 复用 `packages/web/components/ui/` 已有的 Button 组件和 sonner toast

**实现要点**：
- 复用旧 SPA 的成功提示文案模式：`用户 {username} 已创建，默认密码 localapp`
- 错误处理：400/409 都直接显示服务端返回的 error 字段
- 创建成功后刷新当前页的用户列表（重新拉取 `GET /api/admin/users?page=N`）

**Alternatives**:
- 整页路由 `/my/users/new`：增加路由复杂度，对单字段表单过度
- 内联展开式表单：UI 切换不流畅

### Decision 3: API 端不动，仅消费

`POST /api/admin/users` 已在 `fe7ac8b` 实现，行为：
- 接受 `{ username }`
- 默认密码 = `ADMIN_DEFAULT_PASSWORD`（即 localapp）
- `must_change_password = 1`
- 成功返回 `{ success, data: { id, name, role } }`
- 用户名冲突返回 409
- 用户名格式错误返回 400

本次只补前端调用方，不动 server。

### Decision 4: Dockerfile 清理范围

**选择**：移除 `COPY packages/admin/package.json packages/admin/` 这一行；如果后续 `RUN pnpm install` 因此报错，则进一步清理。

**理由**：当前 Dockerfile 在 install 后只用 `packages/web/out/` 作为静态产物，admin 包从未参与构建链。但保险起见，实施时验证镜像构建。

## Risks / Trade-offs

- **[风险] 历史代码从此不易"对照查看"** → Mitigation：git show / git log -- 完全可用；旧 SPA 的实现方式在新 web 里都有对应版本
- **[风险] 创建用户弹窗与现有 UI 组件不匹配** → Mitigation：实施时优先复用 `packages/web/components/ui/` 已有 Button、Dialog（如有）；样式上参考 `force-change-password` 页面的弹窗
- **[风险] 删除 packages/admin 后 Dockerfile 构建失败** → Mitigation：实施后必须执行一次 `docker build .`（或至少 `pnpm install` + `pnpm build`）验证
- **[权衡] 不顺手清理 user-profile-ui spec** → 该 spec 描述的 `/profile` 路径本就过时，但本次扩范围会让变更失控。该清理应作为独立变更

## Migration Plan

按顺序执行，每步可独立验证：

1. 删除两个 SPA 目录（`git rm -r packages/admin packages/profile`）
2. 清理 `pnpm-workspace.yaml`（移除 `packages/admin` 条目）
3. 清理 root `package.json`（删除 `build:admin`、`build:profile`）
4. 清理 `Dockerfile`（移除 admin 相关 COPY 行）
5. 在 `packages/web/app/(dashboard)/my/users/page.tsx` 添加"创建用户"按钮和弹窗
6. 验证：
   - `pnpm install` 成功（确认无悬空引用）
   - `pnpm build` 成功（确认构建链未受损）
   - 浏览器访问 `/my/users`，点击"创建用户"，创建测试用户，验证列表刷新 + toast + 该用户可登录 + 强制改密
7. （可选）`docker build .` 验证镜像构建

**Rollback**: 任一步骤失败，`git revert` 整个变更即可。删除的目录从 git 历史恢复。

## Open Questions

无。所有决策点已在上文明确。
