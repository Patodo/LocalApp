## ADDED Requirements

### Requirement: init 命令在 builtin-repo 且 skip-deploy 时无需登录

CLI `init` 命令在使用 `--builtin-repo` 和 `--skip-deploy` 参数时 SHALL 不要求已配置登录信息。此时仅执行本地模板解压和项目文件写入，不访问服务端。`dev-config.json` 的 `serverUrl` SHALL 写入空字符串。

#### Scenario: builtin-repo + skip-deploy 无需配置即可初始化
- **WHEN** 执行 `localapp init --name my-app --builtin-repo --skip-deploy`，且未配置 serverUrl 和 apiKey
- **THEN** 解压内置模板 → 写入 manifest.json 和 dev-config.json（serverUrl 为空）→ 输出 `{"created":"my-app"}`，不报登录错误

#### Scenario: builtin-repo + skip-deploy 无 git 环境也可完成
- **WHEN** 执行 `localapp init --name my-app --builtin-repo --skip-deploy`，且系统无 git
- **THEN** 使用内置模板完成初始化，不尝试 git clone

#### Scenario: 仅 builtin-repo（未 skip-deploy）仍需要登录
- **WHEN** 执行 `localapp init --name my-app --builtin-repo`（未指定 --skip-deploy），且未配置登录信息
- **THEN** 输出错误 `{"error": "Not configured. Run 'localapp login' first."}`，因为部署步骤需要服务端

#### Scenario: 默认 init（不用 builtin-repo）即使 skip-deploy 也可能需要获取模板 URL
- **WHEN** 执行 `localapp init --name my-app --skip-deploy`（未指定 --builtin-repo），且未配置登录信息
- **THEN** 报登录错误，因为需要调用 `/api/config` 获取模板来源
