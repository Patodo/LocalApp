## MODIFIED Requirements

### Requirement: Tailwind CSS 入口文件

模板 SHALL 包含 `src/index.css` 文件，内容为 `@import "@localapp/app-kit/styles/preset.css";`。`src/main.tsx` SHALL 导入该 CSS 文件。原有的 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 等条目 SHALL 全部移入 `runtime/styles/preset.css`，由用户 `src/index.css` 通过单一 import 引用。

`runtime/styles/preset.css` SHALL 同时提供 DevShell 运行所需的稳定样式 token。DevShell SHALL NOT 依赖 Tailwind 默认 palette 是否存在；用于 DevShell 的颜色、边框、强调色和视觉锚点 SHALL 由 LocalApp runtime 明确定义的语义 token 或 `localapp-dev` 专属 token 提供。

#### Scenario: index.css 存在且极简
- **WHEN** 查看 `init-repo/src/index.css`
- **THEN** 文件包含 `@import "@localapp/app-kit/styles/preset.css";` 以及用户自定义主题变量（如有），不再直接 import tailwindcss / shadcn

#### Scenario: main.tsx 导入 CSS
- **WHEN** 查看 `init-repo/src/main.tsx`
- **THEN** 文件顶部包含 `import "./index.css";`

#### Scenario: preset.css 包含完整 Tailwind 入口
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 `@import "tailwindcss";`、`@import "tw-animate-css";`、`@import "shadcn/tailwind.css";` 以及主题变量定义

#### Scenario: preset.css 提供 DevShell 专属 token
- **WHEN** 查看 `init-repo/runtime/styles/preset.css`
- **THEN** 文件包含 `--localapp-dev`、`--localapp-dev-foreground`、`--localapp-dev-muted`、`--localapp-dev-muted-foreground`、`--localapp-dev-border`、`--localapp-dev-accent`、`--localapp-dev-accent-foreground`
- **AND** 文件包含对应的 Tailwind theme 映射，使 `bg-localapp-dev-*`、`text-localapp-dev-*`、`border-localapp-dev-*` 可被生成

#### Scenario: 单一 import 可生成 DevShell 样式
- **WHEN** 用户项目的 `src/index.css` 只导入 `@localapp/app-kit/styles/preset.css`
- **AND** DevShell 源码使用 `localapp-dev` token class
- **THEN** Vite/Tailwind 编译产物 SHALL 包含 DevShell 关键 token utility
- **AND** DevShell 关键元素 SHALL NOT 因缺少 Tailwind 默认 palette 而退回透明背景或默认黑色文本
