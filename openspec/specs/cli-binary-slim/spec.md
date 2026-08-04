## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the cli-binary-slim capability in LocalApp.

## Requirements

### Requirement: Exclude node_modules from compile-time embedding
build.rs SHALL 在编译前将 init-repo 复制到 `target/init-repo-staging/` 目录，排除 `node_modules/`、`dist/`、`.next/` 子目录，并将 `INIT_REPO_DIR` 环境变量指向 staging 目录。

#### Scenario: Binary size under 30MB
- **WHEN** `cargo build --release` 完成
- **THEN** 生成的 `target/release/localapp` 二进制文件小于 30MB

#### Scenario: Template extracts correctly without node_modules
- **WHEN** 用户运行 `localapp init --name my-app`
- **THEN** 模板正常提取到 my-app 目录，包含 src/、package.json、vendor/ 等文件

#### Scenario: Cargo clean removes staging directory
- **WHEN** 执行 `cargo clean`
- **THEN** `target/init-repo-staging/` 目录被完全移除

### Requirement: Staging dir tracks init-repo changes
build.rs SHALL 设置 `cargo:rerun-if-changed` 指令指向 init-repo 的关键文件，确保模板变更时触发重编译。

#### Scenario: Template change triggers rebuild
- **WHEN** init-repo/package.json 被修改后执行 `cargo build --release`
- **THEN** cargo 检测到变更并重新编译（不使用缓存）
