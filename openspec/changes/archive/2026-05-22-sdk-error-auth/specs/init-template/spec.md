## MODIFIED Requirements

### Requirement: CLAUDE.md AI 助手指南

模板 SHALL 包含 `CLAUDE.md` 文件，面向 AI 助手说明平台能力和 SDK 用法。内容 SHALL 包含：平台能力概述、SDK Hook 参考文档（含 error 字段）、错误处理模式、认证跳转指南、CLI 命令参考、常见开发模式示例。

#### Scenario: CLAUDE.md 包含 Hook 文档
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含每个 Hook 的签名、参数说明和示例代码，包含 `error` 返回字段

#### Scenario: CLAUDE.md 包含错误处理说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `LocalAppError` 类型说明，以及使用 `error.status` 区分 401/403 的示例代码

#### Scenario: CLAUDE.md 包含登录跳转说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `redirectToLogin()` 函数的使用示例，说明如何在检测到 401 时引导用户登录

#### Scenario: CLAUDE.md 包含 CLI 命令
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档包含 `localapp schemas create`、`localapp upload` 等常用命令说明

#### Scenario: CLAUDE.md 包含访问控制说明
- **WHEN** 查看 `init-repo/CLAUDE.md`
- **THEN** 文档说明页面级和路由级访问控制的配置方法
