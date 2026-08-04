## Context

当前 SDK 存在两份代码：
- `packages/client/src/` — pnpm workspace 中的开发包，含单元测试
- `init-repo/src/lib/localapp/` — 分发给用户的模板内嵌源码，通过 `include_dir!()` 编译进 CLI 二进制

两者已不同步（init-repo 多了 `users()`、`groups()`、`groupMembers()` 等 API）。分发链路为：init-repo → `include_dir!()` → CLI 二进制 → `localapp init` 复制到用户项目 → `npm run build` 打包 → `localapp upload` 上传 dist。

用户主要通过 AI agent 生成应用，不修改 SDK 代码。`localapp upload` 当前仅收集 dist 文件上传，不执行构建。

## Goals / Non-Goals

**Goals:**
- init-repo 成为 SDK 唯一源码和测试位置
- `localapp upload` 自动刷新 SDK 并构建，用户无感知
- 消除两份代码维护的同步负担

**Non-Goals:**
- 不处理已部署应用的 SDK 更新（静态文件，下次 upload 自然更新）
- 不引入运行时 SDK 注入（架构变动过大）
- 不修改 SDK 的 API 或功能

## Decisions

### Decision 1: init-repo 作为唯一真相源

**选择**: 删除 `packages/client/`，SDK 开发和测试全部在 `init-repo/` 进行

**替代方案**:
- 保留 `packages/client/` 作为主源，反向同步 → 但当前 init-repo 的 SDK 已领先，反向同步会丢失功能
- 两份都保留，强化 sync:sdk → 维护负担不减

**理由**: init-repo 已有完整的 vitest 环境、testing-library 依赖，且是实际分发给用户的代码。以它为准最自然，消除了"哪个是主源"的歧义。

### Decision 2: upload 时自动刷新 SDK + 构建

**选择**: `localapp upload` 执行三步：① 用内置模板覆盖 `src/lib/localapp/` → ② `npm run build` → ③ 收集 dist 上传

**替代方案**:
- 仅刷新 SDK，不构建 → 用户需要手动构建，体验不一致
- 新增 `localapp sdk update` 独立命令 → 用户需要记住多一步操作，不符合"自动"要求
- 在用户项目的 vite 插件中处理 → 需要修改模板，且离线开发不可用

**理由**: `localapp init` 已经有 install + build + upload 的完整流程。upload 加上 SDK 刷新和构建后，用户只需一个命令 `localapp upload` 就能完成开发→部署全流程。CLI 的 `include_dir!()` 保证了内置模板永远包含最新 SDK。

### Decision 3: 测试迁移到 init-repo

**选择**: 将 `packages/client/src/__tests__/` 迁移到 `init-repo/src/lib/localapp/__tests__/`

**理由**: init-repo 已配置 vitest + jsdom + @testing-library/react，测试可直接运行。保持测试与源码在同一位置，减少认知负担。

## Risks / Trade-offs

**[upload 时间增加]** → 新增 SDK 覆写 + npm build 步骤。Mitigation: SDK 覆写是文件级操作，毫秒级；npm build 是必须步骤（之前用户手动执行），总时间不变。

**[packages/client 删除后，monorepo 内其他包可能引用它]** → Mitigation: `@localapp/client` 标记为 `private`，仅用于内部测试，删除前 grep 确认无外部引用。

**[init-repo 不在 pnpm workspace 中，CI 需要适配]** → Mitigation: init-repo 已有自己的 `npm test` 脚本，CI 单独在 init-repo 目录下执行测试即可。
