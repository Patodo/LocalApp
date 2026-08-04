## MODIFIED Requirements

### Requirement: CLI binary compilation & location
测试 helper SHALL 自动定位 CLI 二进制文件。路径 SHALL 为 `packages/cli/target/debug/localapp`（或 Windows 下的 `.exe`）。若二进制不存在，helper SHALL 执行 `cargo build --manifest-path packages/cli/Cargo.toml` 编译。定位和编译逻辑 SHALL 从原 `tests/e2e/` 路径适配到新的 `tests/e2e-ui/` 路径。

#### Scenario: CLI 二进制已存在
- **WHEN** `packages/cli/target/debug/localapp` 已存在
- **THEN** 直接使用，不重新编译

#### Scenario: CLI 二进制不存在
- **WHEN** CLI 二进制文件不存在
- **THEN** 执行 cargo build 编译，编译失败时测试跳过

## ADDED Requirements

### Requirement: 集成测试目录从 e2e 重命名为 integration
`packages/server/tests/e2e/` SHALL 重命名为 `packages/server/tests/integration/`。package.json 的 test script SHALL 更新为指向新路径。

#### Scenario: vitest 运行集成测试
- **WHEN** 执行 `npx vitest run tests/integration/`
- **THEN** 所有 25 个集成测试正常运行

#### Scenario: package.json test script 更新
- **WHEN** 查看 packages/server/package.json 的 test script
- **THEN** 路径指向 `tests/integration/`
