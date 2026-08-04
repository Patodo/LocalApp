## ADDED Requirements

### Requirement: 上传产物可被 native shell 挂载
上传的前端产物 SHALL 包含 native shell 可解析的 Vite 标准资源引用。服务端 SHALL 能从最新版本产物中定位应用入口 JS 和 CSS。

#### Scenario: 上传 Vite dist 后 native 可加载
- **WHEN** 用户上传包含 `index.html` 和 `assets/*` 的 Vite dist
- **THEN** 服务端 SHALL 保存完整版本产物
- **AND** native shell SHALL 能加载该版本入口资源

### Requirement: 上传成功后 native 入口立即使用最新版本
上传新版本成功后，native shell SHALL 立即使用新版本资源和 backend contract。

#### Scenario: 上传后访问最新应用
- **WHEN** 用户上传 vN 后立即访问生产页面
- **THEN** 页面 SHALL 加载 vN 的应用资源
- **AND** Named SQL SHALL 使用 vN 对应 backend contract 和已迁移的 app.db schema
