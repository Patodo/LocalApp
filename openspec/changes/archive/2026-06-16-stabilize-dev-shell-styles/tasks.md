## 1. RED: 锁定 DevShell 样式回归

- [x] 1.1 添加失败测试：扫描 `init-repo/runtime/dev-shell.tsx`，拒绝 `bg-zinc-`、`text-zinc-`、`border-zinc-`、`bg-indigo-`、`text-indigo-`、`border-indigo-`、`bg-emerald-`、`text-emerald-`、`from-indigo-`、`via-fuchsia-`、`to-orange-` 等裸 palette class
- [x] 1.2 添加失败测试：检查 `init-repo/runtime/styles/preset.css` 必须声明 `--localapp-dev`、`--localapp-dev-foreground`、`--localapp-dev-muted`、`--localapp-dev-muted-foreground`、`--localapp-dev-border`、`--localapp-dev-accent`、`--localapp-dev-accent-foreground`
- [x] 1.3 添加失败测试：通过 Vite/Tailwind 编译或现有模板测试确认 `bg-localapp-dev-*`、`text-localapp-dev-*`、`border-localapp-dev-*`、视觉锚点相关 class 可生成 CSS
- [x] 1.4 添加失败测试：DevShell 渲染后 DEV 徽章、Dev Toolkit 按钮、AI 按钮的 computed style 不得是透明背景或默认黑色文本
- [x] 1.5 运行 `pnpm -C init-repo test -- dev-shell vite-plugin`，确认新增测试在当前实现下失败

## 2. GREEN: 建立 runtime 样式 token 契约

- [x] 2.1 在 `init-repo/runtime/styles/preset.css` 中新增 DevShell 专属 CSS 变量默认值
- [x] 2.2 在 `@theme inline` 中映射 `--color-localapp-dev-*` token，使 Tailwind v4 可生成 `localapp-dev` utility
- [x] 2.3 为 DevShell 视觉锚点新增稳定 token，支持 `from-localapp-dev-*`、`via-localapp-dev-*`、`to-localapp-dev-*` 或等价的稳定实现
- [x] 2.4 确认 `src/index.css` 仍只需单一 import，不引入用户侧 safelist 或额外配置
- [x] 2.5 运行第 1 组测试，确认 token 相关测试通过

## 3. GREEN: 替换 DevShell 不稳定 palette class

- [x] 3.1 将 DevShell 顶部 nav、DEV 徽章、tools、Dev Toolkit、AI 按钮改为语义 token 或 `localapp-dev` token class
- [x] 3.2 将 Dev Toolkit 面板中的标题、边框、按钮、输入框、诊断列表、业务规则摘要改为稳定 token class
- [x] 3.3 将 AI 面板、消息气泡、输入框、发送按钮、tool call 展示改为稳定 token class
- [x] 3.4 将视觉锚点彩条从 `from-indigo-500 via-fuchsia-500 to-orange-400` 改为 runtime token 驱动
- [x] 3.5 运行 `pnpm -C init-repo test -- dev-shell vite-plugin`，确认 DevShell 样式契约测试通过
- [x] 3.6 提交本阶段变更，commit message 使用中文 Conventional Commits

## 4. REFACTOR: 收敛样式命名和测试边界

- [x] 4.1 整理 DevShell class 拼接，减少重复 token class 字符串
- [x] 4.2 调整测试命名和断言文案，让失败信息明确指出缺失 token 或裸 palette class
- [x] 4.3 检查 `init-repo/runtime/styles/preset.css` token 数量，只保留 DevShell 实际使用的有限集合
- [x] 4.4 运行 `pnpm -C init-repo test`
- [x] 4.5 提交本阶段变更，commit message 使用中文 Conventional Commits

## 5. 验证与真实项目同步

- [x] 5.1 运行 `pnpm -C init-repo build`
- [x] 5.2 检查生产 build 产物不包含 `Dev Toolkit`、`localapp:dev-context-changed`、`/api/dev/context`、`/api/dev/data`、`/api/dev/diagnostics`、`/api/dev/business`
- [x] 5.3 运行 `cargo build --package localapp` 构建 debug CLI
- [x] 5.4 在 `E:\Code\localapp\LocalApp-work\sample-app` 执行新版 `localapp sync --quiet`
- [x] 5.5 在 `sample-app` 中运行 `npm install` 和 `npm run build`
- [x] 5.6 启动或复用 `sample-app` dev server，访问 `http://localhost:5173/?todoUnified=1`，用浏览器 computed style 验证 DEV 徽章、Dev Toolkit 按钮、AI 按钮和面板样式正常
- [x] 5.7 运行 `npx openspec validate stabilize-dev-shell-styles --strict`
- [x] 5.8 更新 tasks 完成状态并准备实施完成后的 review
