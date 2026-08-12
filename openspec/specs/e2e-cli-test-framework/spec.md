## Purpose

定义从真实 npm tgz 运行唯一 `localapp` CLI 与统一 Server 的端到端测试框架。

## Requirements

### Requirement: 测试真实 npm 安装

测试框架 SHALL 构建 `localapp-<version>.tgz`，安装到仓库 `tmp/` 下的空目录并定位
`node_modules/.bin/localapp`。测试不得调用已删除的原生 CLI 或 workspace 源入口冒充发行物。

#### Scenario: 首次运行安装 tgz

- **WHEN** 验收目录尚未安装 LocalApp
- **THEN** 测试 SHALL 使用 npm 安装本次生成的 tgz
- **AND** `localapp --version` SHALL 返回 tgz 的版本

#### Scenario: 安装内容与仓库隔离

- **WHEN** CLI 从验收目录执行
- **THEN** CLI、Server、模板和 native adapter SHALL 从已安装 npm 包解析

### Requirement: 测试用 Server 启动

每个测试套件 SHALL 通过 `localapp server run` 启动独立 Server，使用随机回环端口和
仓库 `tmp/` 下的明确数据目录，并在结束时关闭完整进程树。

#### Scenario: Server 启动与配置

- **WHEN** 测试套件初始化
- **THEN** 前台 Server SHALL 输出结构化 readiness，并保持完整认证与权限

#### Scenario: 测试套件结束后清理

- **WHEN** 测试套件结束
- **THEN** SHALL 关闭 Server 并只清理本次创建的仓库内目录

### Requirement: CLI 子进程执行器

框架 SHALL 提供可指定参数、cwd、环境和超时的 CLI 子进程执行器，并同时收集退出码、
stdout 与 stderr。

#### Scenario: 执行成功命令

- **WHEN** 执行已正确配置的 CLI 命令
- **THEN** SHALL 返回退出码 0 和稳定输出

#### Scenario: 执行失败命令

- **WHEN** 命令输入或目标配置无效
- **THEN** SHALL 返回非零退出码和可操作错误，且不泄露 API Key

### Requirement: 端到端安全边界

E2E SHALL 覆盖非 owner 操作、ACL、上传限制、Scheme 注入、daemon 生命周期以及
从正式 `/{owner}/{app}/` 路由访问已安装应用；`/serve/` 只能用于资源/API 诊断。

#### Scenario: 未授权操作被拒绝

- **WHEN** 非授权用户修改其它用户的应用或数据
- **THEN** Server SHALL 返回 403 且数据保持不变

#### Scenario: Scheme 不携带可执行内容

- **WHEN** `localapp://` URL 包含脚本、命令、凭据或未知字段
- **THEN** native adapter 或 daemon SHALL 拒绝激活且不执行动作
