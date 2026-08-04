## MODIFIED Requirements

### Requirement: CLI 编译时打包 init-repo 模板
CLI 二进制 SHALL 在编译时通过 `include_dir!` 将 init-repo 模板源码嵌入。build.rs SHALL 在编译前将 init-repo 复制到 `target/init-repo-staging/`（排除 `node_modules/`、`dist/`、`.next/`），并将 `INIT_REPO_DIR` 指向 staging 目录。解压范围 SHALL 排除 `node_modules/` 和 `dist/` 目录。

#### Scenario: 编译成功包含模板
- **WHEN** 执行 `cargo build` 编译 CLI
- **THEN** 生成的二进制包含 init-repo 源码文件（package.json, vite.config.ts, src/ 等），不包含 node_modules/

#### Scenario: 编译时模板目录不存在
- **WHEN** `init-repo/` 目录不存在或路径配置错误
- **THEN** 编译失败并给出明确错误信息

#### Scenario: Staging 目录自动清理
- **WHEN** 执行 `cargo clean`
- **THEN** `target/init-repo-staging/` 被完全移除

### Requirement: init-repo 路径可通过环境变量配置
构建系统 SHALL 支持通过 `INIT_REPO_DIR` 环境变量指定 init-repo 目录路径。默认行为 SHALL 自动将 init-repo 复制到 `target/init-repo-staging/` 并指向 staging 目录。

#### Scenario: 使用默认路径
- **WHEN** 未设置 `INIT_REPO_DIR` 环境变量
- **THEN** build.rs 自动复制 init-repo（排除 node_modules/dist/.next）到 `target/init-repo-staging/`，并设置 `INIT_REPO_DIR` 指向 staging 目录

#### Scenario: 使用自定义路径
- **WHEN** 设置 `INIT_REPO_DIR=/path/to/custom-template`
- **THEN** 从指定路径复制到 staging 目录并嵌入
