## MODIFIED Requirements

### Requirement: init 使用 npm 模板

`localapp init --name <name>` 命令 SHALL 默认使用内置模板初始化项目。`--skip-install` 标志 SHALL 跳过 `npm install`。`--skip-deploy` 标志 SHALL 跳过部署步骤（注册、构建、上传），但不跳过依赖安装。`--builtin-repo` 标志 SHALL 保留用于离线场景。

#### Scenario: 从内置模板初始化
- **WHEN** 用户执行 `localapp init --name my-app`
- **THEN** CLI 使用内置模板创建项目
- **THEN** CLI 自动运行 `npm install` 安装依赖
- **THEN** 项目创建完成，包含 `package.json`、`node_modules` 和基础文件

#### Scenario: 跳过依赖安装
- **WHEN** 用户执行 `localapp init --name my-app --skip-install`
- **THEN** CLI 使用内置模板创建项目
- **THEN** CLI 不运行 `npm install`
- **THEN** 终端提示 "Skipping npm install. Run 'npm install' manually to install dependencies."

#### Scenario: 跳过部署
- **WHEN** 用户执行 `localapp init --name my-app --skip-deploy`
- **THEN** CLI 创建项目并安装依赖
- **THEN** CLI 跳过部署步骤（注册 page、构建、上传）
- **THEN** 终端提示部署步骤已跳过
