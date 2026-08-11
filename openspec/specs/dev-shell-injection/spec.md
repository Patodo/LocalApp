## Purpose

TBD — DevShell 虚拟模块注入规格，定义 DevShell 如何由 vite-plugin 在 dev 模式通过虚拟模块注入，并完全隔离于生产构建产物之外。
## Requirements
### Requirement: DevShell 通过 vite-plugin 虚拟模块注入

DevShell SHALL 完全由 vite-plugin 在 dev 模式注入，**禁止**作为用户源代码（main.tsx 或其他文件）的依赖。注入机制 SHALL 使用 vite 的虚拟模块约定：

- vite-plugin.mjs 在 `command === 'serve'` 时激活 `transformIndexHtml` 钩子
- 钩子将 index.html 中的 `<script type="module" src="/src/main.tsx">` 替换为 `<script type="module" src="/virtual:localapp-dev">`
- vite-plugin 实现 `resolveId` 钩子，识别 `\0virtual:localapp-dev` 虚拟 ID
- vite-plugin 实现 `load` 钩子，返回虚拟模块代码，内容为：导入 DevShell、导入 App、调用 createRoot 渲染 `<DevShell><App /></DevShell>`
- `command === 'build'` 时 vite-plugin SHALL NOT 激活任何注入逻辑，index.html 原样输出

DevShell 的导入路径 SHALL 为 `@localapp/app-kit/dev-shell`，App 的导入路径 SHALL 严格为 `/src/App.tsx`。

#### Scenario: dev 模式注入 DevShell
- **WHEN** 用户执行 `localapp dev` 启动 vite dev server
- **THEN** vite-plugin 激活 `transformIndexHtml`，将 `<script src="/src/main.tsx">` 替换为 `<script src="/virtual:localapp-dev">`
- **AND** 浏览器加载页面时，vite-plugin 的 `resolveId`/`load` 钩子返回虚拟模块代码
- **AND** 虚拟模块导入 DevShell 和 App，渲染 `<DevShell><App /></DevShell>`
- **AND** 用户在浏览器看到 DevShell 工具栏（DEV 徽章、AI 按钮等）和 App 内容

#### Scenario: 生产构建不含 DevShell
- **WHEN** 用户执行 `npm run build`（即 `vite build`）
- **THEN** vite-plugin 检测到 `command === 'build'`，所有钩子 no-op
- **AND** index.html 中的 `<script src="/src/main.tsx">` 原样保留
- **AND** main.tsx 只渲染 `<App />`（不引用 DevShell）
- **AND** 生成的 `dist/index.html` 和 `dist/assets/*.js` 不含 DevShell 相关代码

#### Scenario: dist 产物验证 DevShell 隔离
- **WHEN** 对 `dist/` 目录运行字符串搜索 `"DevShell"`、`"localapp-dev"`、`"@localapp/app-kit/dev-shell"`
- **THEN** 搜索结果为空，证明 DevShell 完全不进入生产构建

#### Scenario: 用户 main.tsx 不引用 DevShell
- **WHEN** 检查模板的 `src/main.tsx` 内容
- **THEN** 文件只包含 `import App` 和 `render(<App />)`，不包含任何 DevShell 导入或引用

### Requirement: App 路径严格假设为 src/App.tsx

vite-plugin 的虚拟模块 SHALL 硬编码导入 `/src/App.tsx` 作为用户 App 的入口。CLI 不提供配置项覆盖此路径。

#### Scenario: 用户 App 在标准路径
- **WHEN** 用户 App 位于 `src/App.tsx`（默认模板结构）
- **THEN** vite-plugin 虚拟模块的 `import App from "/src/App.tsx"` 成功解析
- **AND** dev 模式正常渲染 DevShell 包裹 App

#### Scenario: 用户改了 App 路径
- **WHEN** 用户将 App 移动到非标准路径（如 `src/MyApp.tsx`），但 `src/App.tsx` 不存在
- **THEN** vite-plugin 在 dev 模式启动时检查 `src/App.tsx` 是否存在
- **AND** 文件不存在时，vite-plugin 打印明确错误："localapp: src/App.tsx not found. The dev shell assumes App at src/App.tsx."
- **AND** dev server 仍启动（让用户看到错误信息），但页面加载失败

### Requirement: DevShell 视觉锚点对齐 nav-shell

DevShell 的顶部 nav 栏 SHALL 在代码设计上派生自生产 nav-shell 的结构模型，而不是重新实现一套无约束的独立导航。DevShell SHALL 复用或显式映射生产 nav-shell 的区域划分、布局语义、应用信息区域、用户状态区域和基础样式 token。DevShell SHALL 在最左侧显示 `DEV` 按钮作为开发态唯一额外入口；`DEV` 按钮之后的区域 SHALL 按生产 nav-shell 的布局展示应用级信息区域和用户级操作区域。DevShell SHALL 继续在底部保留 3px 高的彩色视觉锚点条，且该视觉锚点 SHALL 使用 LocalApp runtime preset 明确定义的稳定 token，而不是直接依赖 Tailwind 默认 palette class。

#### Scenario: DevShell 顶栏显示 DEV 入口
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** nav 栏最左侧 SHALL 显示文本为 `DEV` 的按钮
- **AND** 该按钮 SHALL 具有可见背景、文本色、hover 状态和 focus-visible 状态
- **AND** nav 栏 SHALL NOT 显示独立的 `开发` 徽章

#### Scenario: DevShell 顶栏对齐生产 nav-shell
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** `DEV` 按钮之后 SHALL 显示与生产 nav-shell 对齐的应用外壳区域
- **AND** 顶栏 SHALL 展示应用名称或页面名称
- **AND** 顶栏右侧 SHALL 展示当前 dev context 用户状态或未登录状态
- **AND** dev-only 工具入口 SHALL NOT 平铺在生产 nav-shell 的应用名称和用户状态之间

#### Scenario: DevShell 顶栏派生自生产 nav-shell
- **WHEN** 检查 DevShell 顶栏实现
- **THEN** 实现 SHALL 通过共享结构、共享常量、共享子组件或显式映射函数派生自生产 nav-shell
- **AND** `DEV` SHALL 作为开发态扩展点注入到最左侧
- **AND** 实现 SHALL NOT 复制一份与生产 nav-shell 无依赖关系的完整导航结构

#### Scenario: DevShell 显示彩条
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** nav 栏底部出现一条 3px 高的彩色视觉锚点条
- **AND** 视觉锚点条的颜色 SHALL 来自 runtime preset 中的 LocalApp token
- **AND** 视觉锚点条 SHALL NOT 依赖 `from-indigo-*`、`via-fuchsia-*` 或 `to-orange-*` 等 Tailwind 默认 palette class

#### Scenario: DevShell 顶部样式不回退
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** `DEV` 按钮、下拉菜单、AI 按钮和用户状态区域 SHALL 具有可见背景、文本色和状态色
- **AND** computed style SHALL NOT 显示关键背景为 `rgba(0, 0, 0, 0)` 或关键文本回退为默认黑色

### Requirement: DevShell 不复制生产 nav-shell 用户入口

DevShell SHALL 对齐生产 nav-shell 的布局和平台信号，但 SHALL NOT 执行生产 nav-shell 的真实身份操作。DevShell SHALL 显示开发上下文中的当前用户或未登录状态；登录、登出、头像菜单、收藏、通知、Issue 等真实平台 Shell 功能 SHALL 继续只属于生产平台 Shell，除非本地开发后续显式引入对应模拟能力。

#### Scenario: 显示开发上下文身份而非真实登录入口
- **WHEN** dev 模式中 DevShell 渲染
- **THEN** DevShell SHALL 显示当前 dev context 用户或未登录状态
- **AND** DevShell SHALL NOT 显示会触发生产登录、登出或头像菜单的真实入口

#### Scenario: 生产 nav-shell 功能仍归生产 shell
- **WHEN** 应用部署到生产 server 并由平台 Shell 承载
- **THEN** 用户入口、收藏、通知和 Issue 入口 SHALL 由生产 nav-shell 提供
- **AND** DevShell、`DEV` 按钮和开发工具下拉 SHALL NOT 出现在生产页面中

#### Scenario: 开发态外壳引导应用避免重复导航
- **WHEN** 开发者在 `localapp dev` 中查看应用
- **THEN** DevShell SHALL 让开发者能看到应用将被平台 nav-shell 承载的顶栏结构
- **AND** 应用不需要为了预览生产外壳而自行实现应用内导航栏

### Requirement: 注入的 DevShell 包含开发工具集且保持生产隔离

vite-plugin 在 dev 模式注入的 DevShell SHALL 包含开发工具集入口，用于身份、时间、数据、业务规则和诊断调试。该工具集 SHALL 只存在于 `command === "serve"` 的虚拟模块中，生产构建 SHALL NOT 包含工具集 UI、dev event 名称或 `/api/dev/*` 标识。

#### Scenario: dev 注入工具集
- **WHEN** 用户执行 `localapp dev`
- **THEN** vite-plugin 注入的 DevShell SHALL 渲染开发工具入口
- **AND** 开发工具 SHALL 能访问当前统一 Server 显式开启的 `/api/dev/*` API

#### Scenario: build 不注入工具集
- **WHEN** 用户执行 `npm run build`
- **THEN** vite-plugin SHALL NOT 注入 DevShell 工具集
- **AND** `dist/` 产物 SHALL NOT 包含 `Dev Toolkit`、`localapp:dev-context-changed`、`/api/dev/context`、`/api/dev/data`、`/api/dev/diagnostics` 或 `/api/dev/business`

### Requirement: DevShell 注入样式不得依赖未声明 palette

DevShell 注入相关源码 SHALL NOT 使用 runtime preset 未声明的 Tailwind 默认 palette class。所有 DevShell 颜色、边框、ring、渐变和状态色 SHALL 来自 shadcn 语义 token 或 `localapp-dev` 专属 token。

#### Scenario: 静态检查拒绝裸 palette
- **WHEN** 测试扫描 `init-repo/runtime/dev-shell.tsx`
- **THEN** 文件 SHALL NOT 包含 `bg-zinc-`、`text-zinc-`、`border-zinc-`、`bg-indigo-`、`text-indigo-`、`border-indigo-`、`bg-emerald-`、`text-emerald-`、`from-indigo-`、`via-fuchsia-` 或 `to-orange-`
- **AND** 文件中的 DevShell 专属颜色 class SHALL 使用 `localapp-dev` 前缀或已有语义 token

### Requirement: DevShell 派生自生产 nav-shell
DevShell SHALL 使用生产 nav-shell 的结构和平台能力契约，只在最左侧注入 `DEV` 按钮。`DEV` 下拉 SHALL 包含开发工具和工具面板入口。

#### Scenario: DEV 是唯一额外入口
- **WHEN** dev 模式渲染顶部 shell
- **THEN** 最左侧 SHALL 显示 `DEV` 按钮
- **AND** 其余应用名称、AI 入口、开发上下文用户状态和布局语义 SHALL 与生产 nav-shell 对齐

#### Scenario: 打开 DEV 下拉
- **WHEN** 用户点击 `DEV`
- **THEN** 下拉 SHALL 显示工具和开发工具入口

### Requirement: DevShell 提供 native platform host
DevShell SHALL 在 dev 模式中作为同页 platform host 响应 SDK 平台能力请求，并使用当前统一 Server 的 dev-only API 提供身份、时间、数据和诊断工具。

#### Scenario: dev confirm 使用平台弹窗
- **WHEN** dev 应用调用 `platform.confirm(...)`
- **THEN** DevShell SHALL 显示同页确认弹窗
- **AND** SHALL NOT 调用浏览器原生 `window.confirm`
