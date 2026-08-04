## ADDED Requirements

### Requirement: CRUD 创建记录时填充当前用户字段

CRUD API SHALL 在创建记录时根据 schema 字段的 `constraints.defaultFrom` 填充当前用户字段，并优先使用服务端识别的访问者身份。

#### Scenario: 请求体未提供当前用户字段
- **WHEN** 已登录用户请求 `POST /serve/{userId}/{name}/api/{resource}` 且 schema 字段声明 `defaultFrom: "currentUser.id"`
- **THEN** 创建的记录 SHALL 包含服务端填充的当前用户 ID

#### Scenario: 请求体伪造当前用户字段
- **WHEN** 已登录用户请求创建记录且请求体提供了受 `defaultFrom: "currentUser.id"` 管理的字段
- **THEN** 系统 SHALL 使用服务端识别的当前用户 ID，而不是信任请求体中的值

### Requirement: CRUD 列表查询应用记录级读权限

CRUD API SHALL 在列表查询中应用 schema 的记录级 read 策略，使访问者只能获得被授权读取的记录。

#### Scenario: 只读取自己的记录
- **WHEN** schema 的记录级 read 策略基于 `created_by` 字段匹配当前用户
- **AND** 用户请求列表接口
- **THEN** 返回数据 SHALL 只包含 `created_by` 等于当前用户 ID 的记录

#### Scenario: 页面所有者读取全部记录
- **WHEN** 页面所有者请求列表接口
- **THEN** 系统 SHALL 允许页面所有者读取该 schema 下的全部记录，除非 schema 明确声明更严格的策略

### Requirement: CRUD 单条写操作应用记录级权限

CRUD API SHALL 在更新和删除记录前读取目标记录，并根据 schema 的记录级 update/delete 策略判断当前访问者是否有权操作。

#### Scenario: 记录所有者更新草稿
- **WHEN** 记录级 update 策略要求 `created_by` 匹配当前用户且 `status` 为 `draft`
- **AND** 当前用户更新自己创建的草稿记录
- **THEN** 系统 SHALL 允许更新

#### Scenario: 非记录所有者更新记录
- **WHEN** 记录级 update 策略要求 `created_by` 匹配当前用户
- **AND** 当前用户更新其他用户创建的记录
- **THEN** 系统 SHALL 返回 HTTP 403，且不得修改记录
