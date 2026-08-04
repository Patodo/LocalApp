## ADDED Requirements

### Requirement: Server 托管 Node.js 安装包

Server SHALL 在 `static/deps/node.json` 中声明可用的 Node.js 版本和平台。`node.json` 格式 MUST 包含 `version`（固定 LTS 版本号）和 `platforms`（可用平台到文件名的映射）。

Server SHALL 提供以下公开路由（无需鉴权）：

- `GET /api/deps/node` — 返回 `node.json` 内容
- `GET /api/deps/node/download?os=windows&arch=x86_64` — 流式返回对应平台的安装包，MUST 设置 `Content-Disposition` header

当 `node.json` 或安装包文件不存在时，`/api/deps/node` MUST 返回 404。

#### Scenario: 获取 Node.js 版本信息
- **WHEN** 请求 `GET /api/deps/node`
- **THEN** 返回 200，body 包含 `{ "version": "<版本号>", "platforms": { "windows/x86_64": "<文件名>" } }`

#### Scenario: 下载 Windows 安装包
- **WHEN** 请求 `GET /api/deps/node/download?os=windows&arch=x86_64`
- **THEN** 返回 200，`Content-Disposition: attachment; filename="node-v<版本>-x64.msi"`
- **THEN** body 为 .msi 文件的二进制流

#### Scenario: 未托管时返回 404
- **WHEN** 请求 `GET /api/deps/node` 且 `static/deps/node.json` 不存在
- **THEN** 返回 404

### Requirement: CLI 自动安装 Node.js

CLI 在检测到 Node.js（npm/pnpm）不可用时，SHALL 尝试从已配置的 server 下载并启动 Node.js 安装。

流程：
1. 使用已保存的 `server_url` 请求 `GET /api/deps/node`
2. 如果成功且有 Windows 平台 → 下载 `.msi` 到临时目录，展示下载进度
3. 下载完成后启动安装向导（弹出 Windows 安装界面）
4. 安装完成后提示用户重新运行命令
5. 如果 server 返回 404 或请求失败 → 打印 `nodejs.org` 下载链接，提示用户手动安装

CLI MUST 在下载前提示用户确认："未检测到 Node.js，是否从服务器下载安装？[Y/n]"

#### Scenario: Server 托管了 Node.js，用户确认安装
- **WHEN** CLI 检测到 npm/pnpm 不可用，且 `GET /api/deps/node` 返回 200
- **THEN** 提示用户确认下载
- **THEN** 用户确认后，下载 .msi 文件并弹出安装向导
- **THEN** 安装完成后提示"请重新运行命令"

#### Scenario: Server 未托管 Node.js
- **WHEN** CLI 检测到 npm/pnpm 不可用，且 `GET /api/deps/node` 返回 404
- **THEN** 打印提示："请安装 Node.js v22+ LTS: https://nodejs.org"
- **THEN** 以非零退出码退出

#### Scenario: 用户拒绝安装
- **WHEN** CLI 提示确认下载，用户输入 n
- **THEN** 打印 nodejs.org 下载链接
- **THEN** 以非零退出码退出
