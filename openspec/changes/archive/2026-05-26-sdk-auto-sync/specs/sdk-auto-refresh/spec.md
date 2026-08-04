## ADDED Requirements

### Requirement: upload 时自动刷新 SDK

`localapp upload` 命令 SHALL 在上传前自动将内置模板中的 `src/lib/localapp/` 目录内容覆盖到用户项目的 `src/lib/localapp/` 目录，确保用户项目使用与 CLI 版本一致的 SDK。

#### Scenario: 正常刷新
- **WHEN** 用户项目包含 `src/lib/localapp/` 目录
- **THEN** CLI 用内置模板的 `src/lib/localapp/` 内容完全覆盖该目录，然后继续构建和上传流程

#### Scenario: SDK 目录不存在
- **WHEN** 用户项目不包含 `src/lib/localapp/` 目录
- **THEN** CLI 创建该目录并写入内置模板的 SDK 文件，然后继续构建和上传流程

#### Scenario: 非 LocalApp 项目
- **WHEN** 执行 `localapp upload` 但当前目录没有 `src/` 目录（非 LocalApp 项目结构）
- **THEN** 跳过 SDK 刷新步骤，按原流程上传指定目录的文件
