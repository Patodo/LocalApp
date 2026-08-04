## ADDED Requirements

### Requirement: 模板 runtime 交付 nav-shell 对齐的 DevShell

`init-repo/runtime/dev-shell.tsx` SHALL 交付 nav-shell 对齐后的 DevShell。新建项目和执行 `localapp sync` 的现有项目 SHALL 获得相同的 `DEV` 下拉入口、平台外壳顶栏结构和开发工具面板能力。

#### Scenario: init 模板包含 DEV 下拉
- **WHEN** 用户使用新版 CLI 执行 `localapp init`
- **THEN** 初始化项目的 runtime SHALL 包含 `DEV` 按钮
- **AND** runtime SHALL 将工具列表入口和开发工具入口收纳在 `DEV` 下拉菜单中
- **AND** runtime SHALL NOT 在顶栏中平铺显示 `工具 N` 和 `开发工具` 两个按钮

#### Scenario: sync 更新现有项目 DevShell
- **WHEN** 现有项目执行新版 `localapp sync`
- **THEN** `.localapp/runtime/dev-shell.tsx` SHALL 更新为 nav-shell 对齐版本
- **AND** `.localapp/runtime/styles/preset.css` SHALL 包含该版本所需的稳定样式 token

#### Scenario: 模板测试防止入口回退
- **WHEN** 测试扫描 `init-repo/runtime/dev-shell.tsx`
- **THEN** 测试 SHALL 验证存在最左侧 `DEV` 按钮和下拉菜单
- **AND** 测试 SHALL 验证不存在顶栏平铺的 `开发` 徽章、`工具 N` 按钮和 `开发工具` 按钮

#### Scenario: 生产构建仍隔离 DevShell
- **WHEN** 用户执行 `npm run build`
- **THEN** 生产产物 SHALL NOT 包含 DevShell、`DEV` 下拉、`@localapp/app-kit/dev-shell` 或 `/api/dev/*` 标识
