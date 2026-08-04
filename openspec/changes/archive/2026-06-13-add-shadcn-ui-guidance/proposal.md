## Why

当前 init-repo 已经提供 LocalApp 平台能力、SDK、数据、认证、上传和 Agent 工具指引，但缺少稳定的 UI 组件基础与面向 AI 的视觉实现约束。应用开发者和 Agent 在创建业务应用时容易手写零散 Tailwind 样式，导致界面质量、可访问性和一致性不稳定。

## What Changes

- 在 init-repo 模板中预置 shadcn/ui 全量组件源码及其必要依赖，让应用开发者可以按需直接引用组件。
- 增加 shadcn 所需的项目配置，包括组件清单、路径别名、工具函数和主题变量。
- 增加面向 Agent 的 UI 文件引导，明确优先使用基础组件组合业务 UI，并约束复杂组件的使用场景。
- 更新默认示例应用，使其展示 LocalApp SDK 与 shadcn 基础组件结合的推荐模式。
- 更新测试与规格，确保内置模板、构建产物和 AI 指引文件都包含新的 UI 能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `init-template`: 模板需要预置 shadcn/ui 全量组件、UI 引导文件、路径配置、主题基础设施和示例页面约束。

## Impact

- 影响 `init-repo/` 模板文件、依赖清单、Tailwind/CSS 配置、TypeScript/Vite 路径别名、默认示例页面和 `.claude/skills/` 指引文件。
- 影响 CLI 内置模板打包结果，因为 `packages/cli` 会在构建时嵌入 `init-repo/`。
- 需要更新 init 模板相关测试，验证新建项目可以安装依赖、构建成功，并且 AI 指引文件能引导 Agent 正确使用 shadcn 组件。
