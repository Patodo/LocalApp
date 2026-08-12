# 统一 Server、单一 npm 包与对等同步

LocalApp 只有一个 Server 实现。它可以作为开发机上的本地 Server、局域网 Server、容器 Server 或公开 Server 运行；监听地址、数据目录和存储配置会变化，但应用、认证、权限和文件 API 保持一致。

用户只安装一个 `localapp` npm 包。个人电脑上运行的是当前操作系统用户的常驻 daemon；容器、NAS、局域网主机或公开服务器使用同一包的前台 Server 模式。项目不再提供 Tauri、托盘、Desktop 窗口或单独的 Rust CLI。

```bash
npm install --global localapp
localapp server          # 等同于 localapp server start，注册并启动用户 daemon
localapp server status
localapp server run      # 容器/前台运行
```

`localapp://` 仍由 npm 包内的极小系统适配器注册。适配器只把 Scheme 激活和系统通知点击送回 daemon；应用托管、信任判断、脚本执行和通知状态仍由统一 Server 负责。

## 创建、检查与安装

在应用仓库中：

```bash
localapp check
localapp build --package
localapp app install --target local
```

`app install` 使用目标 Server 的 API Key，把 `.localapp` 包提交到
`/api/me/apps/install`。省略 `--package` 时会先从当前项目构建包：

```bash
localapp app install --target local
localapp app install --target office --package ./dist/my-app.localapp
```

包只包含 manifest、构建后的静态资源、migration 和 backend contract，不包含数据库、上传文件、用户、权限或 API Key。Server 会为同名应用创建首个版本或安装新版本。

## 配置对等 Server 与同步

目标 Server 的 API Key 由目标 Server 管理员在 Web 设置中配置并加密保存。CLI 只向源 Server 提交对端名称，不接触目标凭据：

```bash
localapp app sync --peer office --target local
localapp app sync --peer office --target local --with-data --confirm-app my-app
```

默认只同步应用包、manifest、migration 和 backend contract。`--with-data` 会先在目标端生成一致性备份，再整体替换应用数据库和文件；失败时自动回滚。数据同步要求目标对端已完成能力检查，并且确认名称必须与应用名完全一致。

两端的用户、权限、数据库和上传文件默认互不复制。应用包版本同步完成后，目标端保留自己的所有者和访问策略。

## 系统通知

通知总是先写入来源 Server 的收件箱，再由本机 daemon 通过鉴权 WebSocket 接收并交给系统适配器弹出。默认只启用当前本地账号；远端 Server 账号必须在 Web 设置中显式启用，存在对等同步连接并不等于订阅其通知。

断线重连按投递游标补拉并去重。系统权限被拒绝、设备离线或 daemon 暂停时，通知仍保留在 Web 收件箱。点击系统通知会通过一次性 `localapp://notification/...` ticket 回到 daemon，校验来源和同源相对路径后打开正式应用页面并标记已读。

## 本地访问与开发

Server 默认只监听 `127.0.0.1`。管理员可以在 Web 设置中显式开启局域网访问；无论监听范围如何变化，认证和权限检查都完整启用。

```bash
localapp dev
```

`localapp dev` 只启动当前应用的开发工具链。正式验收和用户访问应使用 Server 返回的 `/<owner>/<app>/` 地址；`/serve/` 仅用于资源/API 诊断。

所有本地 Server 数据、上传文件、下载文件、生成包和验收产物都应放在项目目录下的 `tmp/` 中。不要把项目状态写入系统临时目录。
