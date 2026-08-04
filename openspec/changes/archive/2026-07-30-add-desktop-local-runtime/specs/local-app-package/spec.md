## ADDED Requirements

### Requirement: 可验证的本地应用包

LocalApp CLI SHALL 将通过本地检查和构建的应用生成为 `.localapp` 确定性 ZIP。包 SHALL 包含构建产物、`manifest.json`、migrations、backend contract、平台兼容信息和逐文件 SHA-256 清单，且 SHALL NOT 包含数据库、用户文件、备份、`manifest.platform.json`、凭据、`node_modules` 或可执行服务器脚本。

#### Scenario: 无远端账号构建应用包
- **WHEN** 用户在有效项目中执行 `localapp build --package`
- **THEN** CLI SHALL 在不读取远端 Server 凭据的情况下完成检查和构建
- **AND** 生成可重复校验的 `.localapp` 文件

#### Scenario: 包中不包含本地数据
- **WHEN** 项目目录存在开发数据库、上传文件、平台配置或凭据
- **THEN** 生成的 `.localapp` SHALL NOT 包含这些文件
- **AND** 文件清单 SHALL 只列出允许的发布内容

### Requirement: 安装前完整性与兼容性校验

Desktop SHALL 在修改应用注册表、版本或数据前验证包 schema、应用 ID、版本、平台兼容范围、路径、文件类型、大小预算和全部 checksum。任何验证失败 SHALL 原子拒绝安装。

#### Scenario: 拒绝损坏或越界的包
- **WHEN** 用户安装 checksum 不匹配、包含路径穿越、符号链接或超出预算的 `.localapp`
- **THEN** Desktop SHALL 拒绝安装并返回可操作的错误
- **AND** 已安装版本、注册信息和应用数据 SHALL 保持不变

#### Scenario: 成功安装有效包
- **WHEN** 用户安装兼容且完整的 `.localapp`
- **THEN** Desktop SHALL 将版本写入不可变版本目录并原子设为当前版本
- **AND** 为首次安装的应用创建独立数据目录

### Requirement: 应用升级和数据生命周期分离

Desktop SHALL 在升级前备份目标应用数据，并在修改活动数据库、版本目录或注册表前原子发布持久化事务日志。migration、版本切换、健康检查失败或进程中断后重启时，Desktop SHALL 幂等恢复旧版本、双注册表和升级前数据；只有全部步骤成功后才清理事务日志。卸载应用 SHALL 默认保留应用数据，永久删除数据必须是独立的显式操作；删除事务日志损坏或不完整时 SHALL NOT 阻断 Desktop 启动或访问托管目录之外的路径。

#### Scenario: 升级失败自动回退
- **WHEN** 新包 migration 或启动健康检查失败
- **THEN** Desktop SHALL 保持旧 currentVersion 可用
- **AND** 恢复升级前数据库且不影响其他应用

#### Scenario: 升级中断后恢复
- **WHEN** Desktop 在 migration、注册表切换或健康检查完成后、事务提交前退出
- **THEN** Desktop 下次启动 SHALL 根据持久化日志恢复升级前版本、数据库和双注册表
- **AND** 恢复 SHALL 可重复执行且不得留下失效 currentVersion

#### Scenario: 卸载保留用户数据
- **WHEN** 用户卸载本地应用但未执行永久删除数据
- **THEN** Desktop SHALL 移除应用注册和包版本
- **AND** 保留该应用的数据库、文件和备份
