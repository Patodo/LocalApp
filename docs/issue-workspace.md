# LocalApp Issue 工作台

LocalApp 在 PlatformShell 和 DevShell 中提供平台托管的应用级 Issue 工作台。应用代码不需要自行实现 Issue 列表、评论、附件、标签、负责人、订阅或时间线，也不应直接读写 `_issue_*` 系统表。

## Server 数据边界

| 部署 | Issue 元数据 | 文件与截图 | 身份来源 |
| --- | --- | --- | --- |
| 任意正式 Server | 应用数据库中的平台 `_issue_*` 表 | Server content storage；远程部署可配置 MinIO | 当前 Server 登录用户 |
| `localapp dev` 启动的项目 Server | `tmp/localapp-dev/server/` 下的同一应用数据库实现 | 同一 Server 的本地 content storage | Server 中的 `dev-user`；Dev Toolkit 可模拟该 Server 的其他用户 |

附件通过 `putObject`/`getObject` 访问 Server 内容存储，元数据只保存不可猜测的 storage key。Server 在 MinIO 未配置或不可用时使用自身数据目录；浏览器和应用不能自行选择或绕过该路径。

不同 Server 的 Issue、评论、事件、标签、负责人、订阅和附件互相独立，不会自动同步。`localapp sync --force` 只刷新 CLI 管理的 runtime，不删除项目 `tmp/localapp-dev/server/` 中的应用数据。

## 离线身份

`localapp dev` 启动统一 Server 包，为该 Server 首次初始化 `dev-user` owner，并把 Server URL、应用名和 API Key 写入 `.localapp/dev-config.json`。该流程不要求连接远程 Server。

Dev Toolkit 只能切换当前项目 Server 中真实存在的用户。所有 Issue 写入均以当前开发上下文为准，客户端提交的 reporter、comment author 或 subscriber id 不作为授权身份。

## 权限

- 应用 owner 管理标签定义、Issue 多标签和负责人。
- Issue reporter 管理自己的标题、正文和 Open/Closed 状态。
- 评论只允许评论作者编辑或删除。
- 每个用户只管理自己的订阅。
- 未绑定草稿附件只允许上传者读取；绑定后随 Issue 访问权限读取。
- UI 隐藏仅用于体验；同一 Server route 在本地和远程部署中都逐操作重复授权。
- `_issue_*` 表不得通过应用 CRUD、named SQL 或 raw SQL 暴露。

## 工作台交互

- `/`：在列表态聚焦 Issue 搜索。
- `c`：登录用户在列表态新建 Issue。
- `Escape`：返回或关闭 Issue 工作台。
- `Control/Command+B`、`Control/Command+I`、`Control/Command+K`：编辑器粗体、斜体、链接。
- 输入框、文本域、选择器和可编辑区域不会触发全局列表快捷键。

附件支持文件选择、拖拽和粘贴截图，单文件上限为 25 MiB。上传中或失败附件会阻止提交；未绑定草稿附件在 24 小时后由后续上传触发清理。

## 错误契约

所有部署的 Issue API 都返回相同 JSON envelope。Shell 会先检查 HTTP 状态与 `Content-Type`；上游返回 HTML、非法 JSON 或服务器不可达时，用户只看到可重试的“Issue 服务暂不可用”，不会暴露 `Unexpected token '<'`。
