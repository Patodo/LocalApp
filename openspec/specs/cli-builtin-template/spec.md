## Purpose

定义 `localapp` npm 包内置应用模板的 staging、内容校验、安全提取、用户与 CLI 领地边界，以及 runtime、SDK 和 Agent skills 的同步行为。

## Requirements

### Requirement: npm 打包阶段生成内置模板

package build SHALL 把 `init-repo/` 复制到包 staging，排除 `node_modules/`、`dist/`、
`.next/` 和本地状态，并把 SDK/runtime 的受管文件放入模板。模板缺失或内容摘要无法
验证时构建 SHALL 失败。

#### Scenario: package 包含模板

- **WHEN** 执行 `pnpm -C packages/localapp build:package`
- **THEN** npm artifact SHALL 包含可由 `localapp init` 提取的源码、runtime、SDK 和 skills
- **AND** SHALL 不包含依赖目录或构建输出

#### Scenario: 模板目录不存在

- **WHEN** package build 找不到 `init-repo/`
- **THEN** SHALL 在生成 tgz 前失败并报告明确路径

### Requirement: 模板提取区分用户领地与 CLI 领地

CLI SHALL 把应用源码、manifest、测试和项目配置作为用户领地；把 `.localapp/runtime/`
与 `.claude/skills/localapp*/` 作为 CLI 领地。提取后 SHALL 写入当前 npm package version
的 runtime version，并且不得覆盖已有非空目标目录。

#### Scenario: 提取内置模板

- **WHEN** 执行 `localapp init --name my-app --builtin-repo`
- **THEN** 目标 SHALL 包含完整用户领地和 CLI 领地
- **AND** SHALL 不包含 `node_modules` 或 `dist`

#### Scenario: 版本标记来自 npm package

- **WHEN** 从 `localapp@0.5.0` 初始化项目
- **THEN** `.localapp/runtime/version.json` SHALL 记录 CLI version `0.5.0`

#### Scenario: 目标目录已存在

- **WHEN** 目标目录非空
- **THEN** CLI SHALL 拒绝覆盖并保持原内容

### Requirement: 模板依赖可离线重建

提取后处理 SHALL 把 SDK 放到 `.localapp/runtime/sdk/{core,react,agent}/`，把 workspace
依赖改为本地 `file:` 引用，并注入非阻断的 `localapp sync --quiet` postinstall。

#### Scenario: npm install 成功

- **WHEN** 用户在提取项目中执行 `npm install`
- **THEN** 本地 SDK 与 app-kit SHALL 正确解析且不存在 `workspace:*` 协议错误

#### Scenario: clone 后恢复受管文件

- **WHEN** 用户 clone 未提交 CLI 领地的项目并安装依赖
- **THEN** postinstall SHALL 尝试从当前 `localapp` npm 包恢复 runtime 和 skills

### Requirement: skills 使用目录形态

内置 `.claude/skills/` SHALL 使用一 skill 一目录的 `localapp-*/SKILL.md` 结构，方便
`localapp sync` 按受管前缀原子替换。

#### Scenario: 初始化后 skills 结构一致

- **WHEN** `localapp init` 完成
- **THEN** LocalApp skills SHALL 全部是目录形态且不存在旧扁平文件

### Requirement: 模板运行于正式 Platform Shell

模板 SHALL 使用平台能力入口并说明应用位于 Platform Shell 的 app container 内，不得
要求 iframe 适配或提供第二套本地后端。

#### Scenario: 文档指导正确入口

- **WHEN** 用户阅读生成项目的 Agent 指引
- **THEN** SHALL 指导使用 `/{owner}/{app}/` 做正式验收
- **AND** SHALL 把 `/serve/` 限定为资源/API 诊断
