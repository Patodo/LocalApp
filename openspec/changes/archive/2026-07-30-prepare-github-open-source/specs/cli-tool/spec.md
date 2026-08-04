## MODIFIED Requirements

### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 Server URL 和 API Key。帮助文本 SHALL 使用中文描述命令用途。CLI SHALL 支持通过 `--server-url` 和 `--api-key` 参数进行非交互式登录。

login 命令 MUST 在保存配置前使用候选 API Key 请求目标 Server 的 `GET /api/me`。只有 Server 返回已认证用户对象时才能原子保存配置；验证或写入失败时已有配置 MUST 保持不变。CLI MUST NOT 尝试自动注册，也 MUST NOT 提供或读取 registration key。

#### Scenario: 首次交互式登录成功
- **WHEN** 执行 `localapp login`，输入 Server URL 和有效 API Key
- **THEN** CLI 调用 `GET /api/me` 验证身份
- **AND** 原子保存配置并输出包含当前用户名的成功 JSON

#### Scenario: API Key 无效
- **WHEN** 登录验证返回未认证或 HTTP 401
- **THEN** CLI 输出无效 API Key 的明确错误和联系管理员的提示
- **AND** 不创建或覆盖配置

#### Scenario: Server 无法连接
- **WHEN** 登录验证发生连接、超时或协议错误
- **THEN** CLI 输出可区分的连接或协议错误
- **AND** 已有配置保持字节级不变

#### Scenario: 非交互式配置
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-valid`
- **THEN** 跳过交互输入但仍验证 API Key
- **AND** 验证成功后才保存配置

#### Scenario: 更新已有配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** Server URL 使用当前值作为默认值并提示输入新 API Key
- **AND** 新配置验证成功前不修改旧配置

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp login --help`
- **THEN** 显示中文命令描述
- **AND** 不包含自动注册或 `--registration-key`

## REMOVED Requirements

### Requirement: Registration key 编译时注入

**Reason**: 公开客户端中的共享 registration key 可被任何人提取并滥用，不能构成用户创建权限边界。

**Migration**: 删除 `build.rs` 的 registration key 输入；CLI 登录改用管理员签发并经 Server 验证的 API Key。
