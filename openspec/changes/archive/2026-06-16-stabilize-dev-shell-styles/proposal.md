## Why

DevShell 顶部和工具面板的样式已经第二次在用户项目中出现“CSS 丢失”现象：DOM 和 Tailwind utility class 存在，但颜色类没有生成，导致徽章、按钮、面板等回退到浏览器默认样式。根因是 DevShell 使用了 `zinc`、`indigo`、`emerald` 等 Tailwind 默认调色板 class，而 LocalApp runtime preset 并没有把这些 palette 作为稳定契约提供。

这个问题需要现在修复，因为 DevShell 已经成为本地开发隔离、切换用户、切换时间和数据诊断的核心入口；如果它的样式依赖用户项目主题是否碰巧包含某些默认色阶，后续每次扩展工具集都可能再次复发。

## What Changes

- DevShell SHALL 不再依赖 Tailwind 默认 palette class（如 `bg-zinc-*`、`text-indigo-*`、`from-fuchsia-*`），改为使用 LocalApp runtime 明确定义的语义 token 或 DevShell 专属 token。
- `runtime/styles/preset.css` SHALL 提供 DevShell 所需的稳定颜色、边框、强调色和视觉锚点 token。
- DevShell 顶部 DEV 徽章、工具按钮、AI 按钮、侧栏、诊断区、工具列表和视觉锚点彩条 SHALL 在只导入 `@localapp/app-kit/styles/preset.css` 的项目中正常显示。
- 新增回归测试，静态禁止 DevShell 使用未声明的 Tailwind 默认 palette class，并通过 CSS/浏览器 computed style 验证关键 DevShell 元素不是透明背景或默认黑色文本。
- 保持生产隔离：生产 build 仍不得包含 DevShell、`/api/dev/*`、开发事件名或 DevShell 工具集标识。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `init-template`: runtime `preset.css` 的契约扩展为必须提供 DevShell 所需的稳定样式 token，并支持用户项目通过单一 CSS import 获得完整 DevShell 样式。
- `dev-shell-injection`: DevShell 虚拟注入后的顶部 nav、视觉锚点和基础控件样式必须使用 runtime 稳定 token，而不是 Tailwind 默认 palette。
- `dev-shell-toolkit`: DevShell 工具集的身份、时间、数据、业务规则、诊断和 AI 工具面板必须在本地开发模式下具备稳定可见样式，并通过测试防止样式回退。

## Impact

- 影响 `init-repo/runtime/dev-shell.tsx`：替换不稳定 palette class，统一到 LocalApp 语义 token 或 DevShell 专属 token。
- 影响 `init-repo/runtime/styles/preset.css`：新增 DevShell token 和必要的 theme 映射。
- 影响 `init-repo/tests/*`：新增静态样式契约测试、CSS 产物测试和/或本地浏览器 smoke 测试。
- 影响 `packages/cli` 内置模板产物：重新构建 CLI 后，`localapp sync` 会把修复后的 runtime 同步到现有应用。
- 不改变用户业务代码、SDK API、server API 或生产页面运行时行为。
