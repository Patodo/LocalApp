## ADDED Requirements

### Requirement: upload 构建 backend actions
`localapp upload` SHALL 在构建前端产物时同步构建 backend actions，并在构建失败时阻止上传。

#### Scenario: actions 构建成功
- **WHEN** 项目包含合法 backend actions
- **AND** 用户执行 `localapp upload`
- **THEN** CLI MUST 构建前端产物和 action bundle
- **AND** 将 action manifest 与 bundle 纳入上传 payload

#### Scenario: actions 构建失败
- **WHEN** backend action 存在 TypeScript 编译错误或 contract 校验错误
- **AND** 用户执行 `localapp upload`
- **THEN** CLI MUST 输出错误并以非 0 退出码结束
- **AND** 不得上传任何产物

### Requirement: validate 校验 backend actions
CLI SHALL 在 validate 或 upload 前置校验中检查 backend actions 的定义、输入 schema、访问等级和 manifest 产物。

#### Scenario: action 输入 schema 不可序列化
- **WHEN** action 使用无法导出为 manifest 的输入 schema
- **THEN** validate MUST 失败并提示 action 名称

#### Scenario: action 访问等级非法
- **WHEN** action 声明未知 access 值
- **THEN** validate MUST 失败并提示合法 access 值
