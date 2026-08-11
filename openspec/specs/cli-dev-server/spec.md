## Purpose

定义 `localapp dev` 对统一 Server、应用开发包、运行时依赖和 Vite 的生命周期编排。

## Requirements

### Requirement: dev 命令启动统一 Server 和 Vite

`localapp dev` SHALL 校验项目，刷新过期的 CLI runtime 文件依赖，在项目 `tmp/` 下启动 `localapp-server`，初始化本地用户，构建并安装开发包，写入单 Server 配置，然后启动 `dev:vite`。Server 启动失败或应用安装失败时 Vite SHALL NOT 启动。

#### Scenario: 正常启动

- **WHEN** 用户执行 `localapp dev`
- **THEN** CLI SHALL 启动 `localapp-server start --data-dir <project>/tmp/localapp-dev/server --host 127.0.0.1 --port 0`
- **AND** SHALL 等待 Server readiness JSON
- **AND** SHALL 通过正式包安装端点安装当前应用
- **AND** SHALL 写入 `.localapp/dev-config.json`
- **AND** SHALL 启动 `npm run dev:vite` 或对应包管理器命令
- **AND** 终端 SHALL 显示 Vite URL、Local Server URL 和 raw 应用 API URL

#### Scenario: 使用打包的 mjs 启动器

- **WHEN** `LOCALAPP_SERVER_BIN` 指向 `localapp-server.mjs`
- **THEN** CLI SHALL 使用 Node 执行该启动器
- **AND** SHALL 传递相同的 Server 参数和开发工具环境开关

#### Scenario: Server 提前退出

- **WHEN** Server 在输出 readiness 前退出
- **THEN** CLI SHALL 返回明确启动错误
- **AND** SHALL NOT 启动 Vite

#### Scenario: Vite 退出

- **WHEN** Vite 退出或用户中断命令
- **THEN** CLI SHALL 停止并等待 Server 子进程
- **AND** SHALL 保留项目 `tmp/localapp-dev/server/` 数据

### Requirement: 开发包每次构建有唯一版本

开发应用 SHALL 使用合法且唯一的版本字符串。CLI SHALL 继续使用普通应用包结构和安装端点，不得通过复制 dist 到 Server 数据目录绕过验证。

#### Scenario: 未修改 package.json 版本但代码变化

- **WHEN** 两次 `localapp dev` 的 package.json 版本相同但包 digest 不同
- **THEN** 两次开发包版本 SHALL 不同
- **AND** 第二次安装 SHALL 成为同名应用的新版本

### Requirement: runtime 依赖刷新是精确同步

当 `.localapp/runtime` 与 `node_modules/@localapp/*` 内容不一致时，CLI SHALL 运行依赖安装，把 runtime package 精确同步到已安装 file dependency，删除目标中的过期文件，并清理 `node_modules/.vite`。该过程 SHALL NOT 删除应用源码、Server 数据或用户文件。

#### Scenario: 旧模板服务文件残留

- **WHEN** CLI runtime 已不再包含某个旧文件，但 `node_modules/@localapp/app-kit` 仍包含该文件
- **THEN** `localapp dev` SHALL 在启动前删除已安装包中的该过期文件
- **AND** Vite SHALL 使用刷新后的统一 Server 代理
