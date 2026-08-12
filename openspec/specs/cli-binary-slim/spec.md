## Purpose

定义单一 `localapp` npm 包的体积、模板 staging、内容白名单、独立安装和可重复构建边界，确保发行物不携带 workspace 开发状态或用户数据。

## Requirements

### Requirement: npm 包不携带开发依赖

打包流程 SHALL 在独立 staging 目录组装 CLI、统一 Server、Web、模板和 native adapter，
并排除 `node_modules/`、源码构建缓存、测试、日志和本地数据。

#### Scenario: npm tgz 内容受控

- **WHEN** 执行 `pnpm -C packages/localapp build:package` 并生成 npm tgz
- **THEN** tgz SHALL 只包含声明的 `bin/`、`runtime/`、`template/` 和 artifact manifest
- **AND** SHALL NOT 包含 workspace `node_modules/` 或用户数据

#### Scenario: 模板可独立提取

- **WHEN** 用户从 tgz 安装后执行 `localapp init --name my-app`
- **THEN** 模板 SHALL 正常提取并包含源码、`package.json`、migration、backend contract 和 Agent 指引

### Requirement: 模板变化触发重新打包

包构建 SHALL 从当前 `init-repo/` 生成 staging，并以内容摘要约束复制结果，不得复用无法
证明与当前源码一致的旧 staging。

#### Scenario: 模板变化进入新 tgz

- **WHEN** `init-repo/` 的受管文件发生变化后重新构建
- **THEN** artifact manifest 与 tgz SHALL 反映新内容
