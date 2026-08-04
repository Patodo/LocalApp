## Context

当前 sqlAccess 默认为 null（服务器 fallback 到 "owner"），导致非页面所有者的已登录用户调用 useExec 时被拒绝。这是 Agent 测试中反馈最多的可用性问题之一。

## Goals / Non-Goals

**Goals:**
- useExec 在新创建的应用中开箱即用（已登录用户可执行 SQL）
- 减少用户需要手动修改 manifest 的场景

**Non-Goals:**
- 不改变已有的 access control 架构
- 不增加新的权限级别

## Decisions

选择 `"authenticated"` 而非 `"public"`：已登录用户可执行 SQL 是合理默认，但公开访问应显式启用。

## Risks / Trade-offs

- **[Risk] 已有应用行为变化** → 无 sqlAccess 字段的旧应用现在 fallback 到 `"authenticated"` 而非 `"owner"`，扩大了 SQL 访问范围。影响可接受：这些应用的 owner 也需要手动配置才能限制访问。
