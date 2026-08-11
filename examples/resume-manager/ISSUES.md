# 应用 Issue 能力

应用的 Issue 工作台由 LocalApp PlatformShell/DevShell 提供。不要在业务应用中复制 Issue CRUD、评论、附件或协作元数据 UI，也不要修改 `.localapp/runtime` 来补接口。

## 本地开发

运行 `npm run dev` 或 `localapp dev` 后，Issue 使用项目内启动的统一 LocalApp Server：

- Server 根目录：`tmp/localapp-dev/server/`
- 数据库、文件和截图：由该 Server 按应用隔离管理
- 默认身份：该 Server 中的 `dev-user` owner；Dev Toolkit 可模拟同一 Server 内的其他用户
- 网络要求：Issue 列表、创建、评论、附件、标签、负责人和订阅均不要求连接远程 Server

Dev Toolkit 可以切换身份。权限检查以当前 LocalApp Server 的开发上下文为准，不能通过请求 body 伪造 reporter、评论作者或订阅用户。

每个 Server 都有独立的 Issue 数据，不自动同步。`localapp sync --force` 只恢复 CLI runtime，不删除 `tmp/localapp-dev/server/` 中的数据或附件。同步 runtime 后按 CLI 提示重新运行包管理器安装，以刷新 `node_modules` 中的本地 runtime 链接。

## Hosted

安装到任意 Server 后，应用都使用该 Server 的应用数据库保存 Issue 元数据，文件与截图通过该 Server 的 content storage 保存；远程部署可配置 MinIO。应用只使用 Shell 与公开 Issue API，不读取 `_issue_*` 系统表或存储 key。

权限边界：owner 管理标签和负责人；reporter 管理自己的 Issue 内容与状态；评论只允许作者编辑或删除；每个用户只管理自己的订阅。前端隐藏按钮不是授权，服务端会逐操作检查。

## 快捷键与附件

- `/` 聚焦列表搜索，`c` 新建，`Escape` 返回或关闭。
- Markdown 编辑器支持 `Control/Command+B`、`Control/Command+I`、`Control/Command+K`。
- 输入控件内不会触发全局快捷键。
- 支持选择、拖拽和粘贴附件；单文件上限 25 MiB。
- 上传中或失败附件会阻止提交，可重试或移除。

Issue API 异常必须显示面板内错误。不要直接对响应调用 `response.json()`；平台客户端会先验证状态和 JSON 类型，将 HTML/断网错误统一转换为“Issue 服务暂不可用”。
