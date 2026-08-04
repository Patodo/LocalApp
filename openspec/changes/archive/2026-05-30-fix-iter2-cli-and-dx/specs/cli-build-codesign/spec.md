## ADDED Requirements

### Requirement: Ad-hoc codesigning after build
`npm run build:cli` 脚本 SHALL 在 `cargo build --release` 成功后自动执行 `codesign -s -` 对生成的二进制进行 ad-hoc 签名。

#### Scenario: CLI binary works after copying to new path
- **WHEN** `npm run build:cli` 完成且二进制被 `cp` 到 `~/.local/bin/localapp`
- **THEN** 运行 `~/.local/bin/localapp --version` 返回版本号，不产生 exit 137

#### Scenario: Codesign verification passes
- **WHEN** `npm run build:cli` 完成
- **THEN** `codesign -v target/release/localapp` 返回成功（exit 0）
