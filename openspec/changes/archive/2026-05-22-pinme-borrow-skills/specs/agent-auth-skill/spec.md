## ADDED Requirements

### Requirement: 认证权限 Agent Skill 定义
项目 SHALL 在 `.claude/skills/localapp-auth.md` 中提供认证与权限指导 skill。

#### Scenario: skill 包含用户身份查询文档
- **WHEN** AI 读取 `localapp-auth.md`
- **THEN** skill 包含 `useMe()` Hook 的完整用法、返回类型、常见模式（根据登录状态显示不同内容）

#### Scenario: skill 包含登录跳转文档
- **WHEN** AI 读取 `localapp-auth.md`
- **THEN** skill 包含 `redirectToLogin()` 函数说明、使用场景、登录后自动返回的机制

#### Scenario: skill 包含访问控制配置文档
- **WHEN** AI 读取 `localapp-auth.md`
- **THEN** skill 包含两层访问控制的配置方法：页面级（pageAccess）和路由级（routeAccess），以及四种访问级别的说明（public/authenticated/owner/acl）

#### Scenario: skill 触发条件
- **WHEN** 用户提到登录、权限、认证、访问控制、useMe、redirectToLogin
- **THEN** AI Agent 匹配到 `localapp-auth` skill 的 description 字段并激活
