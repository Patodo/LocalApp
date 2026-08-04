## Context

当前 SDK 代码以源码形式存在于 `init-repo/src/lib/localapp/` 目录，包含三个模块：

- `client.ts` — 纯 JS 客户端 (`LocalAppClient`)，使用 `fetch()` 封装 CRUD API
- `react.ts` — React Hooks 封装 (`useList`、`useCreate` 等)
- `agent/` — AI Agent 集成 (`useAgent`、`AgentChat`、工具定义)

CLI 在执行 `localapp upload`（无路径参数）时，会先从内置模板中提取这些文件复制到用户项目的 `src/lib/localapp/`，再执行 `npm run build`。这导致：

1. SDK 没有版本号，用户无法知道当前使用的 SDK 版本
2. SDK 更新必须连带 CLI 发版（SDK 代码编译在 CLI 二进制中）
3. 即使用户不需要 Agent 功能，也会被复制全部文件
4. `init-repo/` 中的 SDK 代码和实际用户项目中运行的代码是同一份，修改需要特别注意兼容性

重构后，SDK 变为三个独立的 npm 包。用户项目通过 `package.json` 声明依赖，`npm install` 获取。上传流程不再复制 SDK 源码。

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 1 的实施内容。

## Goals / Non-Goals

**Goals:**
- 将 SDK 的三个模块拆分为独立 npm 包，每个包有独立的版本号和 `package.json`
- 保持与现有 SDK 的 API 兼容，已有用户代码无需修改
- `@localapp/sdk` 必须保持零框架依赖，可在任何 JS 环境中使用
- TypeScript 类型从 `@localapp/sdk` 导出，`@localapp/sdk-react` 和 `@localapp/sdk-agent` 依赖它获取类型

**Non-Goals:**
- 不发布到公共 npm registry（初期使用 pnpm workspace 本地引用，后续可发布到私有 registry）
- 不修改 SDK 的 API 设计（API 保持与现有代码一致）
- 不修改服务器端任何代码
- 不修改 `init-repo/` 的应用代码（只修改 `package.json` 和移除 SDK 源码目录）
- 不处理 Agent SDK 依赖的外部包 (`@assistant-ui/react`、`@earendil-works/pi-agent-core`) 的版本管理

## Decisions

### Decision 1: 三个独立包 vs 一个统一包

**选择：** 三个独立包 (`@localapp/sdk`、`@localapp/sdk-react`、`@localapp/sdk-agent`)

**理由：**
- `@localapp/sdk` 是纯 JS 客户端，可用于非 React 项目（如 Vue、Svelte、纯 HTML）
- Agent SDK 依赖 `@assistant-ui/react`，体积较大，按需安装
- 分离后每个包职责清晰，独立发版

**替代方案考虑：** 一个统一包 `@localapp/sdk` 包含所有导出。缺点是会强制 React 用户不需要的 Agent 依赖，以及非 React 用户不需要的 React 依赖。

### Decision 2: 包结构

**选择：**

```
packages/
  sdk-core/              # @localapp/sdk
    src/
      client.ts          # createClient(), detectBasePath(), LocalAppClient
      types.ts           # 所有 TypeScript 类型定义
      index.ts           # 公共 API 导出
    package.json
    tsconfig.json

  sdk-react/             # @localapp/sdk-react
    src/
      hooks/
        use-me.ts
        use-list.ts
        use-get.ts
        use-create.ts
        use-update.ts
        use-delete.ts
        use-count.ts
        use-upload.ts
        use-exec.ts
        use-users.ts
        use-groups.ts
      provider.tsx        # LocalAppProvider (自动检测 basePath)
      index.ts
    package.json
    tsconfig.json

  sdk-agent/             # @localapp/sdk-agent
    src/
      use-agent.ts
      agent-chat.tsx
      context.ts
      tools.ts
      llm-adapter.ts
      assistant-ui-adapter.ts
      types.ts
      index.ts
    package.json
    tsconfig.json
```

**理由：** 按框架依赖分层。`sdk-core` 零依赖，`sdk-react` 依赖 `react` + `sdk-core`，`sdk-agent` 依赖 `sdk-react` + `@assistant-ui/react`。

### Decision 3: 包间依赖方式

**选择：** pnpm workspace 协议 (`"@localapp/sdk": "workspace:*"`)

**理由：** monorepo 内部开发时使用 workspace 协议，发布时由 CI/CD 替换为实际版本号。npm 用户看到的是实际版本。

### Decision 4: init-repo 模板中的 SDK 引用方式

**选择：** 模板 `package.json` 中声明对 `@localapp/sdk` 和 `@localapp/sdk-react` 的依赖，`@localapp/sdk-agent` 为可选依赖。

**理由：** 用户 `npm install` 即可获取 SDK，不再依赖 CLI 复制文件。Agent 功能按需安装。

### Decision 5: CLI upload 流程变更

**选择：** CLI 不再复制 SDK 源文件，只执行 `npm run build`。SDK 刷新由 `npm install` / `npm update` 完成。

**理由：** SDK 现在是正式的 npm 包，版本管理由 npm 生态处理。CLI 负责的是构建和上传，不是依赖管理。

## Risks / Trade-offs

- **现有项目兼容性** → 过渡期保留 `init-repo/src/lib/localapp/` 目录，确保使用旧版 CLI 的用户仍可正常工作。下一版模板移除该目录后，用户需要手动迁移（或重新 `localapp init`）
- **npm registry 可用性** → 初期使用 pnpm workspace 本地引用，无需 registry。后续发版时再决定注册到公共 npm 还是私有 registry
- **SDK API 变更** → 本次重构保持 API 完全兼容。如后续需要 breaking change，走独立发版 + semver major bump
- **Agent SDK 的外部依赖版本漂移** → `@localapp/sdk-agent` 的 `peerDependencies` 声明 `@assistant-ui/react` 的兼容版本范围
