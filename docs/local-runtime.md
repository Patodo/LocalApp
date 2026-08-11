# 统一 Server、本地运行与对等同步

LocalApp 只有一个 Server 实现。它可以作为开发机上的本地 Server、局域网 Server、容器 Server 或公开 Server 运行；监听地址、数据目录和存储配置会变化，但应用、认证、权限和文件 API 保持一致。

可选的 Tauri 程序只是启动同一个 Node Server 的托盘桥接器，提供“打开主页”和“退出本地服务”两个入口，不承载应用管理逻辑。

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

## 本地访问与开发

Server 默认只监听 `127.0.0.1`。管理员可以在 Web 设置中显式开启局域网访问；无论监听范围如何变化，认证和权限检查都完整启用。

```bash
localapp dev
```

`localapp dev` 只启动当前应用的开发工具链。正式验收和用户访问应使用 Server 返回的 `/<owner>/<app>/` 地址；`/serve/` 仅用于资源/API 诊断。

所有本地 Server 数据、上传文件、下载文件、生成包和验收产物都应放在项目目录下的 `tmp/` 中。不要把项目状态写入系统临时目录。
