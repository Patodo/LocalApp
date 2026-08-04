## ADDED Requirements

### Requirement: update 命令

CLI SHALL 提供 `update` 子命令，从已配置的 Server 下载最新二进制并替换当前运行的 CLI。

#### Scenario: 成功更新
- **WHEN** 执行 `localapp update`，Server 返回版本信息且存在对应平台的二进制
- **THEN** 下载二进制到临时文件，移动替换当前可执行文件，输出 `{"success": true, "version": "<new_version>"}`

#### Scenario: 已是最新版本
- **WHEN** 执行 `localapp update`，CLI 版本等于 Server 返回的 `latest`
- **THEN** 输出 `{"success": true, "message": "Already up to date (v<version>)"}`

#### Scenario: 未配置 Server
- **WHEN** 执行 `localapp update` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

## MODIFIED Requirements

### Requirement: JSON 输出格式

所有命令 SHALL 输出 JSON 到 stdout，错误信息输出到 stderr。

#### Scenario: 成功输出
- **WHEN** 命令执行成功
- **THEN** stdout 输出 JSON 对象，包含操作结果数据

#### Scenario: 错误输出
- **WHEN** 命令执行失败
- **THEN** stderr 输出 JSON `{"error": "..."}`，退出码非 0
