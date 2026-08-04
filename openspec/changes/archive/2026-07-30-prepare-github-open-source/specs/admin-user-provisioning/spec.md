## ADDED Requirements

### Requirement: 管理员原子供应用户和初始凭据

管理员创建用户时，系统 MUST 使用密码学安全随机源生成至少 128 bit 熵的临时密码和 API Key，并在同一事务中写入用户、密码哈希、强制改密标记和 API Key 哈希。

#### Scenario: 成功供应用户
- **WHEN** 管理员创建一个合法且不存在的用户
- **THEN** 用户以 `role="user"` 和 `must_change_password=1` 创建
- **AND** 响应包含一次性的 `temporaryPassword` 与 `apiKey`

#### Scenario: 事务中途失败
- **WHEN** 用户、密码或 API Key 任一写入步骤失败
- **THEN** 整个供应事务回滚
- **AND** 系统不返回部分凭据

### Requirement: 明文凭据只展示一次

系统 MUST 只在创建或重置成功响应中返回新生成的明文凭据。用户列表、用户详情、后续查询、日志、遥测和持久化前端状态 MUST NOT 包含明文临时密码或 API Key。

#### Scenario: 关闭一次性凭据对话框
- **WHEN** 管理员关闭创建成功后的一次性凭据对话框
- **THEN** 页面无法再次读取该明文凭据
- **AND** 管理员只能通过重置密码或新建 API Key 生成替代凭据

#### Scenario: 查询已创建用户
- **WHEN** 管理员随后查询用户列表或用户详情
- **THEN** 响应不包含临时密码或 API Key 明文

### Requirement: 管理界面支持安全交付凭据

管理界面 SHALL 在供应成功后显示专用一次性凭据对话框，提供复制临时密码、复制 API Key 和复制全部操作，并在关闭前说明凭据无法再次查看。

#### Scenario: 管理员复制初始凭据
- **WHEN** 管理员在一次性凭据对话框点击复制全部
- **THEN** 剪贴板获得用户名、临时密码和 API Key
- **AND** 页面不把凭据写入 URL 或浏览器持久存储
