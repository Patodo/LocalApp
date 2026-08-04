## ADDED Requirements

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

DevShell 的顶部 nav 栏 SHALL 在底部添加一条彩色渐变条（`bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400`），作为与 nav-shell 一致的视觉锚点。其他元素（DEV 徽章、AI 按钮、tools 列表）保持当前样式不变。

#### Scenario: DevShell 显示彩条
- **WHEN** dev 模式下 DevShell 渲染
- **THEN** nav 栏底部出现一条 3px 高的彩色渐变条
- **AND** 渐变色为 `from-indigo-500 via-fuchsia-500 to-orange-400`，与 nav-shell 的 Navbar 底部彩条一致

#### Scenario: DevShell 不复刻 nav-shell 全部元素
- **WHEN** dev 模式下 DevShell 渲染
- **THEN** DevShell 不显示头像、登录按钮、收藏按钮、通知 bell、issues 按钮
- **AND** 这些功能属于平台身份层（nav-shell），不属于调试工具层（DevShell）
