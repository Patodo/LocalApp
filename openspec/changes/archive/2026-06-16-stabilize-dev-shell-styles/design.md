## Context

DevShell 由 `init-repo/runtime/vite-plugin.mjs` 在 dev 模式通过虚拟模块注入，用户项目只在 `src/index.css` 中导入 `@localapp/app-kit/styles/preset.css`。这意味着 DevShell 的样式必须由 runtime preset 和 Tailwind 编译链共同保证，不能依赖用户业务源码中是否出现过相同 class。

当前 DevShell 使用了大量 Tailwind 默认 palette class，例如 `bg-zinc-100`、`text-indigo-600`、`bg-emerald-500`、`from-indigo-500`。但 runtime preset 主要定义 shadcn 语义 token，并没有把默认 palette 作为 LocalApp 契约暴露。Tailwind v4 在缺少对应 theme token 时不会生成这些颜色 utility，最终表现为 DOM 存在、spacing/font-size 生效、颜色和背景丢失。

## Goals / Non-Goals

**Goals:**

- 让 DevShell 顶部 nav、DEV 徽章、工具按钮、工具面板和 AI 面板的关键样式在任意 LocalApp 初始化项目中稳定可见。
- 将 DevShell 样式依赖收口到 runtime 自己提供的 token，避免再次依赖 Tailwind 默认 palette。
- 通过静态测试和运行时/产物测试防止新增 DevShell class 重新引入裸 palette。
- 保持 `src/index.css` 单一 import 模型，用户无需手动维护 DevShell 样式。

**Non-Goals:**

- 不重设计 DevShell 布局、交互或信息架构。
- 不改变 SDK、mini-server、server API 或生产 nav-shell。
- 不要求用户项目迁移到新的 Tailwind 配置文件或手写 safelist。
- 不把完整 Tailwind 默认调色板复制为平台契约。

## Decisions

### Decision 1: 使用 LocalApp DevShell 专属 token，而不是补齐 Tailwind 默认 palette

在 `runtime/styles/preset.css` 中新增 DevShell 专属 CSS 变量和 Tailwind theme 映射，例如：

- `--localapp-dev`
- `--localapp-dev-foreground`
- `--localapp-dev-muted`
- `--localapp-dev-muted-foreground`
- `--localapp-dev-border`
- `--localapp-dev-accent`
- `--localapp-dev-accent-foreground`
- `--localapp-dev-danger`
- `--localapp-dev-success`
- `--localapp-dev-stripe-from`
- `--localapp-dev-stripe-via`
- `--localapp-dev-stripe-to`

这些变量映射为 `--color-localapp-dev-*`，DevShell 使用 `bg-localapp-dev-muted`、`text-localapp-dev-muted-foreground`、`border-localapp-dev-border`、`from-localapp-dev-stripe-from` 等 class。

替代方案是补 `--color-zinc-*`、`--color-indigo-*` 等默认 palette。该方案能快速止血，但会继续鼓励 DevShell 使用未声明的 palette，未来新增 `slate`、`violet`、`rose` 等 class 时仍会复发。因此选择专属 token。

### Decision 2: DevShell 组件禁止裸 palette class

为 `init-repo/runtime/dev-shell.tsx` 增加静态测试，禁止以下模式出现在 DevShell 源码中：

- `bg-zinc-`
- `text-zinc-`
- `border-zinc-`
- `bg-indigo-`
- `text-indigo-`
- `border-indigo-`
- `bg-emerald-`
- `text-emerald-`
- `from-indigo-`
- `via-fuchsia-`
- `to-orange-`

允许的颜色来源为 shadcn 语义 token（如 `bg-background`、`bg-muted`、`text-foreground`、`border-border`）和 LocalApp DevShell 专属 token（如 `bg-localapp-dev-*`）。

### Decision 3: 用 computed style 回归覆盖真实问题

这次问题不是 class 缺失，而是 class 存在但 CSS 未生成。因此仅做字符串快照不足以防复发。测试应覆盖至少一个真实渲染信号：

- DEV 徽章背景不是透明；
- DEV 徽章文本不是默认黑色；
- 工具按钮背景不是透明；
- 视觉锚点彩条有实际背景图或背景色；
- 工具面板边框颜色不是默认空值。

如果单元环境难以完整运行浏览器，可先用 Vite/Tailwind 编译产物检查 `.bg-localapp-dev-*`、`.text-localapp-dev-*`、`.from-localapp-dev-*` 是否生成，并在最终 smoke 中用浏览器 computed style 验证。

### Decision 4: 保持生产隔离

样式 token 位于 runtime preset 中，会被用户应用 CSS 入口导入；DevShell 组件代码仍只在 dev 虚拟模块中注入。生产 build 可以包含通用 token CSS，但 MUST NOT 包含 DevShell 组件、`Dev Toolkit`、`localapp:dev-context-changed` 或 `/api/dev/*` 标识。

## Risks / Trade-offs

- [Risk] 新增 token 数量过多导致 preset 更难维护。  
  Mitigation: 只定义 DevShell 实际使用的有限 token，不复制完整默认 palette。

- [Risk] 用户自定义主题覆盖 shadcn token 后，DevShell 对比度变差。  
  Mitigation: DevShell 使用独立 `--localapp-dev-*` 变量，默认不复用用户业务主题的主色；用户仍可显式覆盖这些变量。

- [Risk] 静态禁止列表漏掉新的 palette 前缀。  
  Mitigation: 测试同时要求 DevShell 颜色 class 使用 `localapp-dev` 或语义 token，并配合产物/computed style 测试。

- [Risk] 只修 init-repo 后，已有用户项目不会自动更新。  
  Mitigation: 通过重新构建 CLI 后执行 `localapp sync` 覆盖 `.localapp/runtime/`，并在任务中包含对真实用户项目的同步验证。

## Migration Plan

1. 修改 `init-repo/runtime/styles/preset.css`，加入 DevShell 专属 token 和 theme 映射。
2. 修改 `init-repo/runtime/dev-shell.tsx`，替换裸 palette class。
3. 添加静态测试和 CSS/渲染回归测试。
4. 运行 `pnpm -C init-repo test`、`pnpm -C init-repo build`，确认 dev 和 production 行为。
5. 构建 debug CLI，并在 `sample-app` 运行 `localapp sync --quiet` 验证现有应用可获得修复。

Rollback 策略：如 token 化引发未知样式问题，可回滚 DevShell class 与 preset token 变更；该变更不涉及数据迁移或 API 变更。

## Open Questions

无。当前决策足以进入实施。
