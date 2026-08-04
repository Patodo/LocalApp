## ADDED Requirements

### Requirement: vitest resolve.alias 解决双 React 实例

init-repo 模板的 vitest 配置 SHALL 添加 `resolve.alias`，将 `react` 和 `react-dom` 的导入解析指向模板自身的 `node_modules/react` 和 `node_modules/react-dom`，避免 workspace 符号链接导致的双 React 实例问题。

#### Scenario: 模板测试全绿

- **WHEN** 在 init-repo 目录或 `localapp init` 生成的项目中运行 `npm test`（或 `pnpm test`）
- **THEN** 所有测试通过，无 "Cannot read properties of null (reading 'useState')" 错误

#### Scenario: SDK hooks 在测试中正常工作

- **WHEN** 测试文件中导入 `useList` 并在 `renderHook` 中使用
- **THEN** hook 正常初始化，不抛出 null 引用异常
