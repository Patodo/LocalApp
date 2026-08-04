# LocalApp Issue 工作台

LocalApp 在 PlatformShell 和 DevShell 中提供平台托管的应用级 Issue 工作台。应用代码不需要自行实现 Issue 列表、评论、附件、标签、负责人、订阅或时间线，也不应直接读写 `_issue_*` 系统表。

## 在线与本地边界

| 环境 | Issue 元数据 | 文件与截图 | 身份来源 |
| --- | --- | --- | --- |
| Hosted | 应用数据库中的平台 `_issue_*` 表 | 平台 content storage；生产配置使用 MinIO | 当前平台登录用户 |
| `localapp dev` | `.localapp/dev.db` | `.localapp/issues/attachments/` | `.localapp/dev-config.json` 与 Dev Toolkit 当前身份 |

Hosted 附件通过 `putObject`/`getObject` 访问平台内容存储，元数据只保存不可猜测的 storage key。自托管 server 在 MinIO 不可用时可以降级到 server 数据目录，但这不是浏览器或应用自行选择的存储路径。

本地 Issue、评论、事件、标签、负责人、订阅和附件不会上传，也不会与 Hosted Issue 自动同步。`localapp sync --force` 只刷新 CLI 管理的 runtime，不删除 `.localapp/dev.db` 或 `.localapp/issues/attachments/`。

## 离线身份

`localapp dev` 启动 mini-server，并把 `--dev-user-id` 写入本地开发上下文。已登录时默认使用当前 CLI 用户；没有平台登录或用户目录不可用时，mini-server 仍使用本地 `dev-user` owner 身份，不要求联网。

Dev Toolkit 可以切换本地历史身份或平台用户缓存。所有 Issue 写入均以 mini-server 当前上下文为准，客户端提交的 reporter、comment author 或 subscriber id 不作为授权身份。

## 权限

- 应用 owner 管理标签定义、Issue 多标签和负责人。
- Issue reporter 管理自己的标题、正文和 Open/Closed 状态。
- 评论只允许评论作者编辑或删除。
- 每个用户只管理自己的订阅。
- 未绑定草稿附件只允许上传者读取；绑定后随 Issue 访问权限读取。
- UI 隐藏仅用于体验，Hosted route 与 mini-server 都必须逐操作重复授权。
- `_issue_*` 表不得通过应用 CRUD、named SQL 或 raw SQL 暴露。

## 工作台交互

- `/`：在列表态聚焦 Issue 搜索。
- `c`：登录用户在列表态新建 Issue。
- `Escape`：返回或关闭 Issue 工作台。
- `Control/Command+B`、`Control/Command+I`、`Control/Command+K`：编辑器粗体、斜体、链接。
- 输入框、文本域、选择器和可编辑区域不会触发全局列表快捷键。

附件支持文件选择、拖拽和粘贴截图，单文件上限为 25 MiB。上传中或失败附件会阻止提交；未绑定草稿附件在 24 小时后由后续上传触发清理。

## 错误契约

Hosted 与 mini-server 的 Issue API 必须返回 JSON envelope。Shell 会先检查 HTTP 状态与 `Content-Type`；上游返回 HTML、非法 JSON 或服务器不可达时，用户只看到可重试的“Issue 服务暂不可用”，不会暴露 `Unexpected token '<'`。
