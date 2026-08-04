## MODIFIED Requirements

### Requirement: 系统默认群组

系统初始化时 SHALL 自动创建 `everyone` 系统群组（system=1，creator_id='admin'）。所有现有和新供应用户自动成为 `everyone` 群组成员。

#### Scenario: 系统启动时创建 everyone 群组
- **WHEN** 系统初始化 meta.sqlite 且 bootstrapKey 不为空
- **THEN** `everyone` 群组存在，system=1，所有现有用户均为其成员

#### Scenario: 新供应用户自动加入 everyone
- **WHEN** 管理员成功供应新用户
- **THEN** 该用户自动成为 `everyone` 群组成员
