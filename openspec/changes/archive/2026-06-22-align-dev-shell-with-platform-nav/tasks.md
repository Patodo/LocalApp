## 1. RED：锁定新顶栏契约

- [x] 1.1 在 `init-repo/tests/dev-shell-template.test.ts` 增加失败测试：DevShell 顶栏最左侧存在 `DEV` 按钮，且不存在独立 `开发` 徽章
- [x] 1.2 在 `init-repo/tests/dev-shell-template.test.ts` 增加失败测试：`工具 N` 和 `开发工具` 不再作为顶栏平铺按钮出现，而是位于 `DEV` 下拉菜单中
- [x] 1.3 在 `init-repo/tests/dev-shell-template.test.ts` 增加失败测试：DevShell 顶栏包含生产 nav-shell 的关键平台信号，包括应用名称区域和右侧用户状态区域
- [x] 1.4 在 `init-repo/tests/dev-shell-template.test.ts` 增加失败测试：`DEV` 下拉项点击后分别打开工具列表面板和 Dev Toolkit 面板
- [x] 1.5 在 `init-repo/tests/vite-plugin.test.ts` 或构建隔离测试中增加失败测试：生产 build 不包含 `DEV` 下拉、`Dev Toolkit` 和 `/api/dev/*` 标识
- [x] 1.6 验证：运行 `pnpm -C init-repo test -- dev-shell-template.test.ts vite-plugin.test.ts`，确认新增测试按预期失败

## 2. GREEN：实现 DEV 下拉和 nav-shell 对齐

- [x] 2.1 将 DevShell 顶栏中的 `开发` 文案改为最左侧 `DEV` 按钮，并提供 hover、active、focus-visible 状态
- [x] 2.2 抽取或定义生产 nav-shell 与 DevShell 可共享的导航结构模型、区域划分、布局常量或基础子组件，使 DevShell 顶栏显式派生自平台 nav-shell
- [x] 2.3 实现 `DEV` 下拉菜单状态管理，支持点击打开、再次点击关闭、选择菜单项后关闭
- [x] 2.4 将现有工具列表入口移动到 `DEV` 下拉菜单，保留工具数量展示和打开工具面板能力
- [x] 2.5 将现有开发工具入口移动到 `DEV` 下拉菜单，保留打开 Dev Toolkit 面板能力
- [x] 2.6 重排 DevShell 顶栏，使 `DEV` 后的布局对齐生产 nav-shell：左侧展示应用名称或页面名称，右侧展示当前 dev context 用户或未登录状态
- [x] 2.7 保留 AI 入口的位置和行为，使其符合生产 nav-shell 的右侧操作区预期
- [x] 2.8 确保打开工具面板、Dev Toolkit 面板或 AI 面板时不会被 `DEV` 下拉遮挡
- [x] 2.9 验证：运行 `pnpm -C init-repo test -- dev-shell-template.test.ts vite-plugin.test.ts`，确认 RED 测试通过
- [x] 2.10 提交：提交 DEV 下拉和 nav-shell 对齐实现，提交信息使用 `feat(dev-shell): 对齐平台导航栏`

## 3. REFACTOR：样式和结构收敛

- [x] 3.1 抽取或整理 DevShell 顶栏、DEV 下拉、用户状态和面板入口的局部结构，避免主组件继续膨胀
- [x] 3.2 检查并补充 `init-repo/runtime/styles/preset.css` 中 DevShell 下拉所需的稳定 token，避免依赖 Tailwind 默认 palette
- [x] 3.3 更新样式测试，覆盖 `DEV` 按钮、下拉菜单和用户状态区域的关键 computed style 不透明且非默认黑色
- [x] 3.4 更新文案和可访问性属性，确保 `DEV` 按钮可通过键盘操作，菜单项名称清晰
- [x] 3.5 验证：运行 `pnpm -C init-repo test -- dev-shell-template.test.ts`
- [x] 3.6 提交：提交样式和结构收敛，提交信息使用 `refactor(dev-shell): 收敛导航栏结构`

## 4. 模板同步和真实项目验证

- [x] 4.1 运行 `pnpm -C init-repo build`，确认 TypeScript 和 Vite build 通过
- [x] 4.2 运行 `cargo build` 或使用独立 `CARGO_TARGET_DIR` 编译 debug CLI
- [x] 4.3 在 `E:\Code\localapp\LocalApp-work\sample-app` 使用 debug CLI 执行 `localapp sync`
- [x] 4.4 在 `sample-app` 运行 `pnpm build`，确认同步后的 runtime 不破坏应用构建
- [x] 4.5 在 `sample-app` 运行 debug `localapp dev`，浏览器验证 `http://localhost:5173/?todoUnified=1` 顶栏显示最左侧 `DEV` 按钮，应用外壳区域对齐生产 nav-shell（5173/5174 被占用，实际验证端口为 5175）
- [x] 4.6 浏览器验证点击 `DEV` 下拉可打开工具列表和开发工具，且原顶栏不再平铺显示 `工具 N` 和 `开发工具`
- [x] 4.7 清理验证产生的临时进程、日志和上传/测试数据
- [x] 4.8 提交：提交真实项目验证结果，提交信息使用 `test(dev-shell): 验证导航栏对齐`

## 5. 最终验收

- [x] 5.1 运行 `pnpm -C init-repo test`
- [x] 5.2 运行 `pnpm -C init-repo build`
- [x] 5.3 运行 `openspec validate align-dev-shell-with-platform-nav --strict`
- [x] 5.4 检查 `git diff`，确认没有混入无关目标项目文件或临时文件
- [x] 5.5 更新任务完成状态，记录任何无法自动化验证的手工验证结果
- [x] 5.6 最终提交，提交信息使用 `chore(dev-shell): 完成平台导航栏对齐方案`
