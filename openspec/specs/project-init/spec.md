## Purpose

CLI init 命令的项目初始化能力。包括模板选择、项目脚手架生成、一键部署流程，以及离线初始化等场景。

## Requirements

### Requirement: init generates complete project skeleton
init 命令 SHALL 根据服务端配置自动选择模板来源。默认 SHALL 使用服务端 git URL clone 模板，git clone 失败时自动回退内置模板。`--builtin-repo` 参数 SHALL 跳过 git 直接使用内置模板。

无论模板来源，init 完成后 SHALL 确保 CLI 领地（`.localapp/runtime/` + `.claude/skills/localapp-*/` + `agent-tool-patterns/`）就位，`.localapp/runtime/version.json` 写入当前 CLI 版本。

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
- **THEN** 解压用户领地 + 解压 CLI 领地（含 SDK staging、version.json）→ npm install → 注册页面 → npm run build → 上传 → 输出 `{"created":"my-app","url":"..."}`

#### Scenario: init 后 CLI 领地就位
- **WHEN** 执行 `localapp init --name my-app` 完成
- **THEN** `my-app/.localapp/runtime/` 存在且包含 `version.json`、`sdk/`、`vite-plugin.ts` 等；`my-app/.claude/skills/localapp-*/` 存在

### Requirement: init 生成的 manifest.json 包含 distDir

init 命令生成的 manifest.json SHALL 包含 `name`、`description`（默认空字符串）和 `distDir`（默认 `"dist"`）三个字段。

#### Scenario: manifest.json 默认内容
- **WHEN** `localapp init --name my-app` 成功执行
- **THEN** `my-app/manifest.json` 内容为 `{"name": "my-app", "description": "", "distDir": "dist"}`

### Requirement: upload 命令支持省略路径参数

CLI SHALL 允许 `upload` 命令省略路径参数，此时从 manifest.json 的 `distDir` 字段读取构建产物目录。

#### Scenario: 省略路径参数
- **WHEN** 执行 `localapp upload`（无路径参数），manifest.json 包含 `"distDir": "dist"`
- **THEN** 等价于执行 `localapp upload ./dist`

#### Scenario: 显式指定路径
- **WHEN** 执行 `localapp upload ./build`
- **THEN** 忽略 manifest.json 中的 distDir，使用显式路径 `./build`

#### Scenario: 省略路径但 manifest 无 distDir
- **WHEN** 执行 `localapp upload`，manifest.json 不包含 distDir 字段
- **THEN** 输出错误 JSON `{"error": "No distDir in manifest.json and no path specified"}`

### Requirement: init 命令支持一键部署
`localapp init --name <name>` SHALL 在克隆模板后自动执行安装依赖、注册页面、构建、上传的完整流程。

#### Scenario: 已登录用户执行 init
- **WHEN** 用户已登录（config.json 中有 api_key）且执行 `localapp init --name my-app`
- **THEN** CLI 依次执行：克隆/抽取模板 → 写 manifest.json → npm install（含 postinstall 触发 sync）→ POST /api/pages → npm run build → POST /api/upload → 打印访问 URL

#### Scenario: 未登录用户执行 init
- **WHEN** 用户未登录（config.json 中无 api_key）且执行 `localapp init --name my-app`
- **THEN** CLI 返回错误："Not configured. Run 'localapp login' first."（克隆模板需从服务端获取 templateRepoUrl，因此登录是前置条件）

#### Scenario: 使用 --skip-deploy flag
- **WHEN** 用户执行 `localapp init --name my-app --skip-deploy`
- **THEN** CLI 只执行脚手架步骤，跳过所有部署相关步骤（即使已登录）

#### Scenario: npm install 失败
- **WHEN** init 执行 npm install 时失败（退出码非 0）
- **THEN** CLI 打印错误信息并中止，提示用户可手动 cd 进目录执行 npm install

#### Scenario: 构建失败
- **WHEN** init 执行 npm run build 时失败
- **THEN** CLI 打印错误信息并中止，提示用户可修复后手动 localapp upload

### Requirement: init 命令在 skip-deploy 时无需登录

CLI `init` 命令在使用 `--skip-deploy` 参数时 SHALL 不要求已配置登录信息。此时 SHALL 使用内置模板执行本地脚手架、项目文件写入和可选依赖安装，不访问服务端。未配置 serverUrl 时，`dev-config.json` 的 `serverUrl` SHALL 写入空字符串；已配置 serverUrl 时 SHALL 保留该值供后续上传或远端能力使用。

#### Scenario: skip-deploy 无需配置即可初始化
- **WHEN** 执行 `localapp init --name my-app --skip-deploy`，且未配置 serverUrl 和 apiKey
- **THEN** 解压内置模板 → 写入 manifest.json 和 dev-config.json（serverUrl 为空）→ 输出 `{"created":"my-app"}`，不报登录错误

#### Scenario: skip-deploy 无 git 环境也可完成
- **WHEN** 执行 `localapp init --name my-app --skip-deploy`，且系统无 git
- **THEN** 使用内置模板完成初始化，不尝试 git clone

#### Scenario: 仅 builtin-repo（未 skip-deploy）仍需要登录
- **WHEN** 执行 `localapp init --name my-app --builtin-repo`（未指定 --skip-deploy），且未配置登录信息
- **THEN** 输出错误 `{"error": "Not configured. Run 'localapp login' first."}`，因为部署步骤需要服务端
- **THEN** 报登录错误，因为需要调用 `/api/config` 获取模板来源

### Requirement: init 注入 package.json postinstall 钩子

CLI init SHALL 在生成的用户项目 `package.json` 中注入 postinstall 钩子：`"postinstall": "localapp sync --quiet 2>/dev/null || true"`。此钩子确保用户 clone 项目并执行 `npm install` 后，CLI 领地（`.localapp/runtime/` 等）通过 sync 自动就位。

#### Scenario: init 后 package.json 包含 postinstall
- **WHEN** 执行 `localapp init --name my-app`
- **THEN** `my-app/package.json` 的 `scripts` 字段包含 `"postinstall": "localapp sync --quiet 2>/dev/null || true"`

#### Scenario: 用户覆盖 package.json 后 postinstall 保留
- **WHEN** 用户在 init 后手动修改 package.json（如加新依赖），未删除 scripts.postinstall
- **THEN** 下次 `npm install` 时 postinstall 钩子仍正常触发 sync

### Requirement: init 写入 dev-config.json 的 autoSync 默认值

CLI init SHALL 在 `.localapp/dev-config.json` 中**不**写入 `autoSync` 字段（默认启用自动同步）。用户可通过 `localapp sync --off` 显式关闭。

#### Scenario: init 后 dev-config.json 不含 autoSync
- **WHEN** 执行 `localapp init --name my-app`
- **THEN** `my-app/.localapp/dev-config.json` 仅包含 `serverUrl` 字段，不包含 `autoSync`（视为默认 true）

#### Scenario: 显式关闭后 dev-config.json 包含 autoSync: false
- **WHEN** 执行 `localapp sync --off`
- **THEN** `dev-config.json` 写入 `"autoSync": false`
