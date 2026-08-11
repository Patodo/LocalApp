## Purpose

定义生成应用中的 Agent 指引如何教授 canonical Server 开发、`.localapp` 发布和正式 Browser 验收。

## Requirements

### Requirement: 核心 LocalApp skill 描述统一工作流

生成项目 SHALL 在 `.claude/skills/localapp*/SKILL.md` 和项目 `AGENTS.md` 中提供一致指引。核心流程 SHALL 为读取 manifest/backend contract、`localapp dev`、`localapp check --json`、`localapp app install --target <profile>`，并从 Server 返回的 `/<owner>/<app>/` URL 验收。

#### Scenario: Agent 识别 LocalApp 项目

- **WHEN** Agent 开始修改应用
- **THEN** skill SHALL 指导其读取 `manifest.json`、`AGENTS.md`、backend contract 和 migrations
- **AND** SHALL NOT依赖旧页面 ID 文件或第二后端配置

#### Scenario: Agent 发布应用

- **WHEN** 用户要求把应用安装到一个 Server
- **THEN** skill SHALL 指导先运行 `localapp check --json`
- **AND** 再运行 `localapp app install --target <profile>`
- **AND** 使用正式应用 URL 验证

### Requirement: 指引区分开发 Server 与离线 schema 工具

skill SHALL 说明 `localapp dev` 启动的是项目下的 canonical Server；`tmp/localapp-schema/schema.db` 只用于 migration、seed 和类型检查，不是应用 runtime 数据库。

#### Scenario: Agent 重置测试数据

- **WHEN** Agent 需要重置正在运行的开发应用数据
- **THEN** skill SHALL 指导使用 Dev Toolkit 的 Server 数据操作
- **AND** SHALL NOT把 `localapp db reset` 描述为 runtime 数据重置

### Requirement: 指引使用仓库内 tmp 与应用内 Browser

本地生成项目、Server data、上传、下载和 Device Action 目标 SHALL 位于仓库 `tmp/` 下。用户可见验收 SHALL 使用 `browser:control-in-app-browser` 访问正式 URL；`/serve/<owner>/<app>/` 只用于 raw resource/API 诊断。

#### Scenario: Agent 执行本地验收

- **WHEN** Agent 验证已安装应用
- **THEN** 所有测试产物 SHALL 写入 `<repo>/tmp/` 的明确子目录
- **AND** Browser SHALL 打开 `/<owner>/<app>/`
- **AND** SHALL 检查 DOM、console、核心读写和权限边界

### Requirement: 通用 Device Actions 保持应用无关

Agent 指引 SHALL 把 `device.run()` 描述为当前点击电脑上的显式特权操作，要求最小权限、清晰确认、确定性脚本和结果展示。指引 SHALL NOT 把 SKILL 安装语义写入 Server 或 SDK 通用契约。

#### Scenario: 应用需要当前电脑操作

- **WHEN** Agent 实现本地文件写入或工具调用
- **THEN** skill SHALL 指导使用通用 Device Action
- **AND** SHALL 说明 Scheme ticket 不携带脚本或凭据
- **AND** child-process 权限 SHALL 被描述为当前 OS 用户任意代码执行能力
