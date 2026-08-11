# peer-application-sync Specification

## Purpose

定义彼此独立的 LocalApp Server 如何以对等关系同步应用版本，以及何时显式同步应用实例数据；同步不得建立主从、代管理或共享身份边界。

## Requirements

### Requirement: Server 始终是独立对等端

每个 LocalApp Server SHALL 独立拥有配置、用户、权限、数据目录和管理边界。peer 连接 SHALL 只表示一个 Server 可以向另一个 Server 发起应用同步，不得产生 master/agent、上下级、代理登录或代管理关系。

#### Scenario: 配置一个目标 peer

- **WHEN** 源端管理员保存另一个 Server 的 URL 和目标用户 API Key
- **THEN** 两端 SHALL 继续独立认证和管理用户
- **AND** 源端管理员 SHALL NOT 因该连接取得目标端管理权限

### Requirement: 目标 API Key 只由源 Server 保管和使用

源 Server SHALL 加密保存目标用户 API Key，并且只在目标能力检查和同步请求中解密使用。Web、CLI、列表、响应、错误和日志 SHALL NOT 返回或披露该凭据。目标 Server SHALL 使用自己的正常 API Key 认证验证请求。

#### Scenario: 查看已保存 peer

- **WHEN** 管理员列出或检查 peer
- **THEN** 响应 SHALL 包含名称、URL、已验证目标用户和能力
- **AND** SHALL NOT 包含 API Key、密文或可恢复的凭据片段

### Requirement: 同名应用按目标用户所有权创建或更新

目标 API Key 对应用户 SHALL 成为目标端应用所有者。同步 SHALL 保持 manifest 中的应用名称；目标用户已有同名应用时 SHALL 作为版本更新，首次同步时 SHALL 创建该应用。

#### Scenario: 首次同步到目标用户

- **WHEN** 目标 API Key 用户尚无该名称的应用
- **THEN** 目标 Server SHALL 创建同名应用
- **AND** SHALL 将该目标用户记录为所有者

#### Scenario: 同名应用已存在

- **WHEN** 目标 API Key 用户已有同名应用
- **THEN** 目标 Server SHALL 通过正式应用包安装器创建新版本
- **AND** SHALL 保持应用名称和所有者不变

### Requirement: 默认只同步可移植应用版本

未显式请求数据同步时，peer 同步 SHALL 只传输 `.localapp` 版本包及其中的 manifest、migrations 和 backend contract，不得导入源端应用数据快照。目标端现有实例数据和上传文件 SHALL 留在目标端，并由目标端正式安装器在事务中应用新版本 migrations；migration MAY 对目标应用数据库执行 schema 变换或确定性回填，失败时 SHALL 回滚到安装前版本和数据。两端的用户、团队、角色、session、API Key、权限、Server 配置与平台数据库、Issue、收藏、通知、任务历史、消息、peer 记录和备份历史 SHALL 始终独立且不得同步。

#### Scenario: 默认应用同步

- **WHEN** 源端发起不带 `withData` 的同步
- **THEN** 目标端 SHALL 安装并激活应用版本
- **AND** SHALL NOT 使用源端数据库或文件替换目标端现有业务记录和上传文件
- **AND** 目标数据库只可因该版本的正式 migrations 发生原子 schema 变换或回填，失败 SHALL 回滚
- **AND** 用户、团队、角色、session、API Key、权限、Server 配置与平台数据库、Issue、收藏、通知、任务历史、消息、peer 记录和备份历史 SHALL 继续各自独立

### Requirement: 应用加数据同步执行整体替换与自动回滚

只有用户显式选择应用加数据同步并精确确认应用名时，源端 SHALL 生成仅包含该应用业务数据库和应用文件的一致性快照。目标端 SHALL 在修改前自动创建安全备份，再整体替换该应用的数据库和文件；任一步骤失败 SHALL 恢复安全备份和此前活动应用版本。用户、团队、角色、session、API Key、权限、Server 配置与平台数据库、Issue、收藏、通知、任务历史、消息、peer 记录和备份历史 SHALL NOT 进入快照或从源端复制到目标端。

#### Scenario: 应用加数据同步成功

- **WHEN** 用户发起 `--with-data` 同步并精确确认应用名
- **THEN** 源端 SHALL 传输一致性应用数据快照
- **AND** 目标端 SHALL 先创建本地安全备份
- **AND** SHALL 整体替换目标应用数据库和文件
- **AND** SHALL 保留目标端用户、团队、角色、session、API Key、权限、Server 配置与平台数据库、Issue、收藏、通知、任务历史、消息、peer 记录和备份历史

#### Scenario: 目标导入失败

- **WHEN** 包安装、数据校验、数据库替换、文件替换或激活失败
- **THEN** 目标端 SHALL 自动恢复同步前的应用版本、数据库和文件
- **AND** SHALL 报告失败或 `recovery-required`，不得报告部分成功
