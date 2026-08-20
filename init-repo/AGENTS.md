# LocalApp 应用开发约定

这是一个由统一 LocalApp Server 托管的 React + TypeScript 应用。开发、发布和本地运行使用同一套 Server API；不要实现第二套后端或把本机状态写到系统临时目录。

## 本地闭环

所有生成的 Server 数据、上传/下载文件和手工验收产物放在项目自己的 `tmp/` 下。修改后执行：

```bash
npm run build
localapp check --json
localapp app install --target <server-profile>
```

安装命令会构建当前项目并把应用包写入指定 Server。应用功能必须从正式 `/<owner>/<app>/` 路径验收；raw `/serve/` 路径仅用于 API 或静态资源诊断。使用应用内 Browser 检查 DOM、console、核心交互和权限，不以构建成功代替验收。

migration 与 backend contract 由 `localapp check` 在安装前验证。运行中应用的数据重置、快照和恢复由 Dev Toolkit 调用当前统一 Server 完成，不要另起应用私有后端。

离线 schema 检查数据库固定放在 `tmp/localapp-schema/schema.db`，不要复用运行时数据库。

## 通用 Device Actions

需要在“当前点击按钮的这台电脑”执行本机操作时，使用 SDK 的 `device.run()`。请求只声明完成任务所需的最小权限，例如 `filesystemWrite: [selectedRoot]`；不要把凭据、脚本或目标路径塞进 `localapp://` scheme。激活前向用户展示标题、描述、权限和将要修改的路径。

Device Action 脚本是当前操作系统用户代码：保持输入校验、路径边界、幂等和结果类型稳定；只有明确需要时才申请 `childProcess`，因为它等价于允许执行当前用户权限下的任意子进程。通用写法见 `.claude/skills/localapp-device-actions/SKILL.md`。

## 应用代码边界

- 数据库结构写在 `migrations/`，复杂读写写成 backend named SQL；前端通过 SDK hooks、`client.query()` 和 `client.mutate()` 调用。
- 文件上传使用 `useUpload()`，下载使用 SDK 返回的 authenticated content URL；原始文件内容不进入 manifest。
- PDF 预览使用模板已固定的 `react-pdf` 与 `pdfjs-dist`，图片预览使用 `yet-another-react-lightbox` 或等价可访问组件，并清理 object URL。
- 业务状态使用 `manifest.business` 与 named mutation/transition，权限由 Server 后端执行，前端权限组件只负责展示。
- 应用专属的目录、市场元数据和外部工具适配器属于应用自身，不修改通用 Server 或 Device Action skill。

## 实时协作

普通表单记录继续使用 named SQL 或 `record-versioned` 协作；只有文本、富文本、白板等必须自动合并的内容才使用可选的 `@localapp/crdt`。使用前阅读 `.claude/skills/localapp-collaboration/SKILL.md`，在 manifest 声明 CRDT 资源、`platformVersion: ^1.3` 及所需 primitives。

需要显示“谁正在编辑什么”时，在应用 DOM 上提供稳定的 `data-localapp-edit-surface` / `data-localapp-edit-field`，并通过 provider 发送 editing target。遮罩由 Platform Shell 绘制；应用不要发送 CSS selector、用户身份、颜色，也不要自行实现另一套 presence 服务。
