# native-app-runtime Specification

## Purpose
TBD - created by archiving change native-app-runtime. Update Purpose after archive.
## Requirements
### Requirement: Native 应用挂载
LocalApp SHALL 将生产应用作为平台 shell 内的 native app 挂载运行。应用代码 SHALL 挂载到平台提供的 app container，而不是运行在 iframe document 中。

#### Scenario: 生产页面不包含 iframe
- **WHEN** 用户访问已发布应用的生产页面
- **THEN** 页面 SHALL 渲染平台 nav-shell
- **AND** 页面 SHALL 包含 native app mount container
- **AND** 页面 SHALL NOT 包含用于承载应用的 iframe

#### Scenario: 应用资源从最新版本加载
- **WHEN** 应用上传新版本并成为 currentVersion
- **THEN** native app mount SHALL 加载该最新版本的 JS 和 CSS 资源
- **AND** 后续访问 SHALL 不再加载旧版本应用资源

### Requirement: 平台能力同页宿主
LocalApp SHALL 在 native 页面中提供同页 platform host。应用 SHALL 通过 SDK 平台能力接口请求确认弹窗、下载、剪贴板、路由、AI、用户和服务器时间能力。

#### Scenario: native host 响应平台能力
- **WHEN** 应用调用 `platform.confirm(...)`
- **THEN** 同页 platform host SHALL 渲染平台确认弹窗
- **AND** SDK SHALL 收到布尔结果

#### Scenario: 应用不感知运行模式
- **WHEN** 应用调用 `platform.downloadFile(...)`
- **THEN** 应用代码 SHALL NOT 需要判断 iframe、parent window 或 sandbox 状态
- **AND** 平台 SHALL 使用 native host 完成下载

### Requirement: 平台 shell 区域不可被应用拥有
平台 nav-shell、认证入口、AI 侧栏、确认弹窗和平台级 overlay SHALL 由平台拥有。native 应用 SHALL 只拥有 app container 内部 DOM。

#### Scenario: 应用挂载不覆盖 nav-shell
- **WHEN** native 应用渲染全屏布局
- **THEN** 平台 nav-shell SHALL 仍然可见且可交互
- **AND** 应用内容 SHALL 被限制在 app container 内

### Requirement: 后端权限边界保持不变
Native runtime SHALL NOT 放宽任何后端访问权限。应用数据写入 SHALL 继续通过 Named SQL 或平台公开 API 完成，平台用户、管理、上传和订阅等 API SHALL 继续执行服务端权限校验。

#### Scenario: 应用不能绕过 Named SQL
- **WHEN** native 应用尝试访问已移除的 raw SQL 或 legacy CRUD 端点
- **THEN** 服务端 SHALL 按现有规则拒绝请求
- **AND** native runtime SHALL NOT 提供额外后门

### Requirement: native 应用验收运行在正式 Shell route

LocalApp native 应用的用户体验验收 SHALL 在正式 Shell route `/{userId}/{name}` 中进行。该验收 SHALL 覆盖平台 nav-shell、平台能力 host 和 app container 的组合运行形态。`/serve/{userId}/{name}/` SHALL NOT 被用作 native 应用用户体验验收入口。

#### Scenario: 验证 native app 生产形态
- **WHEN** agent 验证已上传应用的生产形态
- **THEN** agent SHALL 打开 `/{userId}/{name}`
- **AND** 页面 SHALL 渲染平台 nav-shell
- **AND** 页面 SHALL 包含 native app mount container

#### Scenario: raw 页面不能代表生产形态
- **WHEN** agent 打开 `/serve/{userId}/{name}/`
- **THEN** 页面 MAY 返回上传应用的裸 `index.html`
- **AND** 该结果 SHALL NOT 被用于判断 native Shell、平台能力 host 或 nav-shell 是否正常

### Requirement: 本地应用使用正式 native Shell

Local Runtime SHALL 使用与生产应用一致的同页 native app host 契约承载应用。Local Platform Shell SHALL 拥有导航、确认弹窗和平台 overlay，应用 SHALL 只拥有 app container；Desktop 和用户 SHALL NOT 使用 raw asset route 作为正式入口。

#### Scenario: 本地正式入口包含 Shell
- **WHEN** 用户从 Desktop 打开已安装应用
- **THEN** 浏览器 SHALL 渲染 Local Platform Shell 和 native app mount container
- **AND** 页面 SHALL NOT 使用 iframe
- **AND** 应用 SDK SHALL 无需判断 local 或 hosted 运行模式
