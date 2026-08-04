## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the sdk-test-fix capability in LocalApp.
## Requirements

### Requirement: convertUserTool 测试使用 lazy getter 模式

`convertUserTool` 的函数签名为 `(name: string, getDef: () => UserToolDef)`，第二个参数是返回工具定义的 getter 函数。所有测试调用 SHALL 传入 `() => ({...})` 形式的 getter 函数，而非直接传入工具定义对象。

#### Scenario: agent-tools.test.ts 中所有 convertUserTool 调用
- **WHEN** 运行 `vitest run` 测试
- **THEN** `agent-tools.test.ts` 中 5 处 `convertUserTool` 调用均使用 `() => (...)` 包装器，所有测试通过

#### Scenario: agent-runtime.test.ts 中所有 convertUserTool 调用
- **WHEN** 运行 `vitest run` 测试
- **THEN** `agent-runtime.test.ts` 中 2 处 `convertUserTool` 调用均使用 `() => (...)` 包装器，所有测试通过

#### Scenario: 模板项目测试全绿
- **WHEN** 在 `localapp init` 生成的项目中运行 `npm test`
- **THEN** 所有 96 个测试通过，0 个失败

### Requirement: vitest resolve.alias 解决双 React 实例

init-repo 模板的 vitest 配置 SHALL 添加 `resolve.alias`，将 `react` 和 `react-dom` 的导入解析指向模板自身的 `node_modules/react` 和 `node_modules/react-dom`，避免 workspace 符号链接导致的双 React 实例问题。

#### Scenario: 模板测试全绿

- **WHEN** 在 init-repo 目录或 `localapp init` 生成的项目中运行 `npm test`（或 `pnpm test`）
- **THEN** 所有测试通过，无 "Cannot read properties of null (reading 'useState')" 错误

#### Scenario: SDK hooks 在测试中正常工作

- **WHEN** 测试文件中导入 `useList` 并在 `renderHook` 中使用
- **THEN** hook 正常初始化，不抛出 null 引用异常
