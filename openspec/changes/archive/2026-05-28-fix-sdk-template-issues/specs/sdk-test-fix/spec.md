## ADDED Requirements

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
