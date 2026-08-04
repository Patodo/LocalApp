## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the cli-build-codesign capability in LocalApp.

## Requirements

### Requirement: Ad-hoc codesigning after build
`npm run build:cli` 脚本 SHALL 在 `cargo build --release` 成功后自动执行 `codesign -s -` 对生成的二进制进行 ad-hoc 签名。

#### Scenario: CLI binary works after copying to new path
- **WHEN** `npm run build:cli` 完成且二进制被 `cp` 到 `~/.local/bin/localapp`
- **THEN** 运行 `~/.local/bin/localapp --version` 返回版本号，不产生 exit 137

#### Scenario: Codesign verification passes
- **WHEN** `npm run build:cli` 完成
- **THEN** `codesign -v target/release/localapp` 返回成功（exit 0）

### Requirement: GitHub workflow 构建跨平台 CLI

正式发行 SHALL 在 GitHub 托管的 Linux、macOS 和 Windows runner 上分别构建、测试和打包对应 CLI，不得以单平台伪装其他平台产物。

#### Scenario: 跨平台构建完成
- **WHEN** 版本 tag 触发 release workflow
- **THEN** 每个受支持目标均由对应 runner 生成并通过 `--version` smoke test

### Requirement: 发行资产记录签名状态

Release workflow MUST 对支持的产物执行配置的正式签名或现有 ad-hoc 签名验证，并在发行清单中记录真实签名状态。缺少正式证书时 MUST NOT 将产物标记为正式签名。

#### Scenario: macOS ad-hoc 签名
- **WHEN** macOS runner 未配置正式 Developer ID 证书
- **THEN** CLI 通过 ad-hoc codesign 验证
- **AND** 清单将签名状态记录为 `adhoc`

#### Scenario: 正式签名秘密缺失
- **WHEN** workflow 未获得某平台正式签名凭据
- **THEN** workflow 按发行策略生成明确的未正式签名产物或阻止正式发布
- **AND** 不伪造签名成功状态
