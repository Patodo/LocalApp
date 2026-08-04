# 应用 Issue 能力

应用的 Issue 工作台由 LocalApp PlatformShell/DevShell 提供。不要在业务应用中复制 Issue CRUD、评论、附件或协作元数据 UI，也不要修改 `.localapp/runtime` 来补接口。

## 本地开发

运行 `npm run dev` 或 `localapp dev` 后，Issue 完全使用本地 mini-server：

- 数据库：`.localapp/dev.db`
- 文件和截图：`.localapp/issues/attachments/`
- 默认身份：当前 dev context；没有平台登录时使用本地 `dev-user` owner
- 网络要求：Issue 列表、创建、评论、附件、标签、负责人和订阅均不要求连接 LocalApp server

Dev Toolkit 可以切换身份。权限检查以 mini-server 当前身份为准，不能通过请求 body 伪造 reporter、评论作者或订阅用户。

本地 Issue 和 Hosted Issue 是两套数据，不自动同步。`localapp sync --force` 只恢复 CLI runtime，不删除本地 Issue 数据或附件。同步 runtime 后按 CLI 提示重新运行包管理器安装，以刷新 `node_modules` 中的本地 runtime 链接。

## Hosted

上传后的应用使用平台数据库保存 Issue 元数据，文件与截图通过平台 content storage 写入 MinIO。应用只使用 Shell 与公开 Issue API，不读取 `_issue_*` 系统表或存储 key。

权限边界：owner 管理标签和负责人；reporter 管理自己的 Issue 内容与状态；评论只允许作者编辑或删除；每个用户只管理自己的订阅。前端隐藏按钮不是授权，服务端会逐操作检查。

## 快捷键与附件

- `/` 聚焦列表搜索，`c` 新建，`Escape` 返回或关闭。
- Markdown 编辑器支持 `Control/Command+B`、`Control/Command+I`、`Control/Command+K`。
- 输入控件内不会触发全局快捷键。
- 支持选择、拖拽和粘贴附件；单文件上限 25 MiB。
- 上传中或失败附件会阻止提交，可重试或移除。

Issue API 异常必须显示面板内错误。不要直接对响应调用 `response.json()`；平台客户端会先验证状态和 JSON 类型，将 HTML/断网错误统一转换为“Issue 服务暂不可用”。
