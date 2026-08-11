## Purpose

定义每个 canonical Server 独立的管理员角色、首位管理员初始化和最后管理员保护规则。

## Requirements

### Requirement: 管理员角色模型

Server 的 `users` 表 SHALL 支持 `admin` 与 `user` 角色。普通管理员供应的新用户默认 SHALL 为 `user`；只有 clean setup 创建的首位用户自动成为 `admin`。所有 `/api/admin/*` 路由 SHALL 对 session 和 API Key 使用同一角色校验。

#### Scenario: clean setup 创建首位管理员

- **WHEN** 空 Server 通过有效 setup token 创建第一个用户
- **THEN** 该用户 SHALL 成为 `admin`
- **AND** Server SHALL 消耗全部未使用 setup token

#### Scenario: 管理员供应普通用户

- **WHEN** 管理员创建后续用户且未显式授予管理员角色
- **THEN** 新用户 SHALL 为 `user`

#### Scenario: 非管理员访问管理 API

- **WHEN** 已认证普通用户访问 `/api/admin/*`
- **THEN** Server SHALL 返回 403

### Requirement: 不存在固定系统管理员身份

Server SHALL NOT 自动创建、迁移或保护任何固定用户名。首位管理员使用 setup 页面提交的名称；loopback、本地网络、容器和公网部署使用同一规则。配置中的 bootstrap API Key MAY 在首次 setup 时绑定给该首位管理员，但 SHALL NOT 单独创建用户或绕过 setup token。

#### Scenario: 空 Server 启动

- **WHEN** 新数据目录中没有用户
- **THEN** 用户表 SHALL 保持为空直到 setup 成功
- **AND** readiness SHALL 提供短时、单次 setup URL

#### Scenario: 自定义首位管理员名

- **WHEN** setup 提交用户名 `acceptance-owner`
- **THEN** Server SHALL 创建该名称的管理员
- **AND** SHALL NOT另外创建固定名称账户

### Requirement: 管理员变更保护可用性

管理员 MAY 提升或降级其它用户，但 SHALL NOT 降级自己、删除自己或移除最后一个管理员。保护规则 SHALL 根据当前认证身份和管理员数量计算，不得依赖硬编码用户 ID。

#### Scenario: 提升普通用户

- **WHEN** admin 将普通用户角色改为 `admin`
- **THEN** Server SHALL 持久化角色并在后续认证中生效

#### Scenario: 降级最后管理员

- **WHEN** 操作会使 Server 不再有任何管理员
- **THEN** Server SHALL 返回 400
- **AND** 用户角色 SHALL 保持不变

#### Scenario: 管理员尝试修改自己

- **WHEN** admin 尝试降级或删除自己的账户
- **THEN** Server SHALL 拒绝操作
