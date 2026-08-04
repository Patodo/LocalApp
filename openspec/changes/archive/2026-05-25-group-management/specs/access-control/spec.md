## MODIFIED Requirements

### Requirement: 访问控制级别定义

系统 SHALL 支持四种访问控制级别：`public`（任何人）、`authenticated`（仅登录用户）、`owner`（仅页面所有者）、`acl`（ACL 列表中的用户和群组成员 + 所有者）。所有者（page.userId）在任何级别下 MUST 始终拥有完全访问权限。ACL 列表中的条目 SHALL 支持用户 ID（如 `"userA"`）和群组引用（如 `"group:team-name"`）两种格式。

#### Scenario: 所有者始终有权限
- **WHEN** 访问控制的 level 为 `authenticated` 且请求的 visitorId 等于 page.userId
- **THEN** 访问被允许

#### Scenario: ACL 包含群组引用且用户是成员
- **WHEN** level 为 `acl` 且 ACL 包含 `"group:team"` 且当前用户是 team 群组成员
- **THEN** 访问被允许

#### Scenario: ACL 包含群组引用但用户不是成员
- **WHEN** level 为 `acl` 且 ACL 仅包含 `"group:team"` 且当前用户不是 team 群组成员且不是所有者
- **THEN** 返回 HTTP 403
