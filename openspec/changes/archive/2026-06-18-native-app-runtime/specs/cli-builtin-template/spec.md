## ADDED Requirements

### Requirement: 内置模板生成 native 兼容项目
CLI 内置 init-repo 模板 SHALL 默认生成 native runtime 兼容项目。模板 SHALL 使用 SDK 平台能力入口，不依赖 iframe 或 sandbox。

#### Scenario: localapp init 生成 native 模板
- **WHEN** 用户执行 `localapp init`
- **THEN** 生成项目 SHALL 包含 native runtime 的 `.localapp/runtime`
- **AND** 示例代码 SHALL 通过 SDK 调用平台能力

### Requirement: 内置模板文档说明 native 约束
内置模板 SHALL 在开发指南中说明应用运行在平台 shell 的 app container 内，平台 nav-shell、认证入口和平台能力由平台拥有。

#### Scenario: 文档不再指导 iframe 适配
- **WHEN** 用户阅读模板 skills 或开发文档
- **THEN** 文档 SHALL NOT 要求开发者处理 iframe sandbox 限制
- **AND** 文档 SHALL 指导使用 `platform-runtime`
