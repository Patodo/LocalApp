## MODIFIED Requirements

### Requirement: init generates complete project skeleton
init 命令 SHALL 根据服务端配置自动选择模板来源。默认 SHALL 使用服务端 git URL clone 模板，git clone 失败时自动回退内置模板。`--builtin-repo` 参数 SHALL 跳过 git 直接使用内置模板。

#### Scenario: 默认使用服务端 git URL
- **WHEN** 执行 `localapp init --name my-app`，服务端返回有效 templateRepoUrl 且 git 可用
- **THEN** 走 git clone 流程

#### Scenario: git clone 失败自动回退内置模板
- **WHEN** 执行 `localapp init --name my-app`，git clone 失败
- **THEN** 清理部分 clone 目录，自动回退内置模板

#### Scenario: 服务端无 git URL 直接用内置模板
- **WHEN** 执行 `localapp init --name my-app`，服务端返回空的 templateRepoUrl
- **THEN** 直接使用内置模板

#### Scenario: --builtin-repo 跳过 git
- **WHEN** 执行 `localapp init --name my-app --builtin-repo`
- **THEN** 忽略服务端 git URL，直接使用内置模板

#### Scenario: 内置模板完整部署流程
- **WHEN** 使用内置模板且不跳过部署
- **THEN** 解压 → npm install → 注册页面 → npm run build → 上传 → 输出 `{"created":"my-app","url":"..."}`
