## ADDED Requirements

### Requirement: CLI 编译时打包 init-repo 模板
CLI 二进制 SHALL 在编译时通过 `include_dir!` 将 `init-repo/` 目录的源码嵌入。嵌入范围 SHALL 排除 `node_modules/` 和 `dist/` 目录。

#### Scenario: 编译成功包含模板
- **WHEN** 执行 `cargo build` 编译 CLI
- **THEN** 生成的二进制包含 init-repo 源码文件（package.json, vite.config.ts, src/ 等）

#### Scenario: 编译时模板目录不存在
- **WHEN** `init-repo/` 目录不存在或路径配置错误
- **THEN** 编译失败并给出明确错误信息

### Requirement: 内置模板解压到目标目录
CLI SHALL 将内置模板文件解压到用户指定的目标目录，保持原有目录结构。解压后 SHALL 写入 `manifest.json`（含 name、description、distDir）和 `.localapp/dev-config.json`（含 serverUrl）。

#### Scenario: 解压内置模板
- **WHEN** 执行 `localapp init --name my-app --source builtin`
- **THEN** 目标目录包含完整的 init-repo 源码文件结构（不含 node_modules 和 dist）

#### Scenario: 目标目录已存在
- **WHEN** 执行 `localapp init --name my-app` 且目标目录已存在
- **THEN** 返回错误 "Directory 'my-app' already exists"

### Requirement: init-repo 路径可通过环境变量配置
构建系统 SHALL 支持通过 `INIT_REPO_DIR` 环境变量指定 init-repo 目录路径，默认为 `../../init-repo`（相对于 packages/cli/）。

#### Scenario: 使用默认路径
- **WHEN** 未设置 `INIT_REPO_DIR` 环境变量
- **THEN** 使用默认路径 `../../init-repo` 嵌入模板

#### Scenario: 使用自定义路径
- **WHEN** 设置 `INIT_REPO_DIR=/path/to/custom-template`
- **THEN** 从指定路径嵌入模板
