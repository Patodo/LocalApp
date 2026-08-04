## Context

DevShell 目前由 Vite dev 模式虚拟注入，生产构建不包含该外壳。它的顶部栏承担了 DEV 徽章、工具入口、开发工具入口和 AI 入口，但布局并不等同于生产平台 nav-shell。开发者在本地开发时看到的是“调试外壳”，上线后看到的是“平台外壳”，两者差异会误导应用自己补一个应用内导航栏。

生产平台 nav-shell 已经承担 Home、应用名称、Issue、收藏、AI、用户入口等外壳职责。DevShell 应作为生产 nav-shell 的开发态投影，而不是另一个独立工具栏。

## Goals / Non-Goals

**Goals:**

- 让 DevShell 顶栏在结构和视觉层级上对齐生产 nav-shell。
- 将 `开发` 改为 `DEV`，并将其作为最左侧按钮。
- 将现有“工具”和“开发工具”入口收纳到 `DEV` 下拉框。
- 保持已有工具列表、Dev Toolkit、AI 面板、开发上下文能力可用。
- 让开发者在本地明确感知发布后应用会被平台 nav-shell 承载，从而减少应用内重复导航栏。
- 保持生产构建隔离，build 产物不包含 DevShell 或 dev-only 标识。

**Non-Goals:**

- 不在本变更中实现应用编辑 nav-shell 的能力。
- 不重构生产 PlatformShell 的业务功能。
- 不改变 mini-server API 契约。
- 不改变应用 iframe 或虚拟注入机制。
- 不删除已有 Dev Toolkit 中的身份、时间、数据、诊断等功能。

## Decisions

### 决策 1：DevShell 顶栏派生自生产 nav-shell

DevShell 顶栏 SHALL 在代码设计上派生自生产 nav-shell，而不是重新实现一套独立导航。实现时应优先抽取或复用平台 nav-shell 的结构模型、布局常量、语义 class、区域划分和基础子组件；DevShell 只在该模型最左侧增加 `DEV` 开发态扩展点。

派生关系的目标是让开发态外壳和生产外壳共享同一套导航心智模型：左侧为外壳级导航和应用信息，右侧为平台用户/AI 等外壳操作。`DEV` 是开发态的附加能力入口，不应改变生产 nav-shell 的基本布局语义。

替代方案是仅把现有按钮换样式，不调整信息架构。该方案无法解决开发态与生产态外壳认知不一致的问题，因此不采用。

### 决策 2：`DEV` 按钮承载所有开发态入口

`DEV` 下拉框承载工具列表入口和开发工具入口。这样顶栏默认状态更接近生产 nav-shell，开发态差异集中在一个明确位置。

替代方案是保留平铺的“工具”和“开发工具”按钮。该方案继续占用生产 nav-shell 的位置，且会让开发者误判上线后也存在这些顶栏按钮，因此不采用。

### 决策 3：DevShell 只模拟 nav-shell 视觉和平台信号，不直接复用生产组件

本变更优先在 `init-repo/runtime/dev-shell.tsx` 中实现轻量的 nav-shell 派生结构。它可以读取 dev context 和可得的配置来展示用户状态和应用名称，但不直接引入完整生产 PlatformShell 业务组件。

原因是 DevShell 运行在用户应用的 Vite dev 进程中，必须保持 runtime 模板可同步、轻依赖、生产隔离。直接复用完整生产组件会引入更多平台依赖和认证 UI 复杂度。但实现仍应通过共享结构定义或显式派生组件，避免 DevShell 与生产 nav-shell 未来再次漂移。

### 决策 4：测试以静态结构、构建隔离和浏览器行为为主

本变更需要补充模板静态测试，验证 `DEV` 下拉存在、旧的平铺入口消失、生产 nav 关键文本/结构存在。必要时使用浏览器或 jsdom 验证下拉交互和面板打开行为。

## Risks / Trade-offs

- [Risk] DevShell 复制生产 nav-shell 结构后，未来生产 nav-shell 变化可能再次漂移。  
  Mitigation: 在 spec 中明确 DevShell 顶栏必须派生自生产 nav-shell 的结构模型，而不是复制一份无约束实现；增加模板测试覆盖关键结构。

- [Risk] 将入口收纳到下拉后，开发工具发现性降低。  
  Mitigation: `DEV` 按钮放在最左侧，使用醒目的短标签；下拉项使用清晰中文名称和当前工具数量。

- [Risk] DevShell 直接展示用户状态可能与真实生产 session 不完全一致。  
  Mitigation: 文案和数据来源以 dev context 为准，避免触发真实登录/登出流程；生产认证操作仍只属于生产 nav-shell。

- [Risk] 下拉层级与工具侧栏、AI 侧栏产生 z-index 或焦点冲突。  
  Mitigation: 明确面板打开时下拉关闭，使用稳定 z-index，并增加交互测试。

## Migration Plan

1. 更新 runtime DevShell 顶栏结构和下拉交互。
2. 更新模板测试，先验证旧结构失败，再实现新结构。
3. 运行 `pnpm -C init-repo test -- dev-shell-template.test.ts vite-plugin.test.ts`。
4. 运行 `pnpm -C init-repo build`，确认生产构建隔离。
5. 编译 CLI，确保内置 runtime 包含新 DevShell。
6. 现有应用通过 `localapp sync` 获得新 runtime；如需回滚，可同步上一版 CLI 或恢复 `.localapp/runtime/dev-shell.tsx`。

## Open Questions

- 生产 nav-shell 的完整右侧功能是否都要在 DevShell 中显示占位，还是只显示当前用户状态和 AI 入口？本变更默认显示足以建立外壳预期的核心信号，避免接入真实生产收藏、通知等状态机。
- 应用名称应优先来自 `manifest.name`、`dev-config.pageName`，还是两者组合？本变更默认以 `pageName`/manifest name 作为展示文本。
