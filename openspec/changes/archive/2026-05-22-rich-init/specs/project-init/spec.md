## ADDED Requirements

### Requirement: init 命令生成完整项目骨架

CLI SHALL 提供 `init --name <name>` 命令，从服务器获取模板仓库地址后，通过 git clone 在当前目录下创建以 name 命名的子目录，删除 upstream remote，并注入 manifest.json。

#### Scenario: 成功初始化项目
- **WHEN** 执行 `localapp init --name my-app`，git 已安装，服务器配置了 TEMPLATE_REPO_URL，当前目录下无同名子目录
- **THEN** 从服务器 GET `/api/config` 获取 `templateRepoUrl`，执行 `git clone --depth 1 <templateRepoUrl> my-app`，进入目录执行 `git remote remove origin`，写 `manifest.json`（含 name 和 distDir），输出 `{"created": "my-app"}`

#### Scenario: name 不合法
- **WHEN** 执行 `localapp init --name XX`，name 不符合 kebab-case 规则
- **THEN** 输出错误 JSON `{"error": "Invalid name..."}`，退出码 1

#### Scenario: git 未安装
- **WHEN** 执行 `localapp init --name my-app`，系统未安装 git
- **THEN** 从服务器 GET `/api/config` 获取 `gitDownloadUrl`，输出错误 JSON `{"error": "Git is required. Download from: <gitDownloadUrl>"}`，退出码 1

#### Scenario: git 未安装且服务器未配置下载地址
- **WHEN** 执行 `localapp init --name my-app`，系统未安装 git，且服务器未配置 GIT_DOWNLOAD_URL
- **THEN** 输出错误 JSON `{"error": "Git is required. Please install Git to continue."}`，退出码 1

#### Scenario: 目标目录已存在
- **WHEN** 执行 `localapp init --name my-app`，当前目录下已存在 `my-app/` 子目录
- **THEN** 输出错误 JSON `{"error": "Directory 'my-app' already exists"}`，退出码 1

#### Scenario: 服务器未配置模板仓库
- **WHEN** 执行 `localapp init --name my-app`，但 GET `/api/config` 返回的 `templateRepoUrl` 为空或不存在
- **THEN** 输出错误 JSON `{"error": "Server is not configured with a template repository"}`，退出码 1

#### Scenario: git clone 失败
- **WHEN** 执行 `localapp init --name my-app`，但 git clone 因网络或仓库不存在等原因失败
- **THEN** 输出错误 JSON（包含 git 错误信息），退出码 1

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
