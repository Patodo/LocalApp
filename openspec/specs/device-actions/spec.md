# device-actions Specification

## Purpose

定义任意 LocalApp Web 应用请求“当前点击按钮的这台电脑”执行受控本机操作的通用协议、安全边界和生命周期；该能力不绑定 SKILL 市场或任何单一应用。

## Requirements

### Requirement: Web 应用创建通用 Device Action

应用 SHALL 通过 Server/SDK 提交标题、描述、版本化脚本、结构化输入、依赖、超时和最小权限声明。Server SHALL 记录来源 Server、应用、版本、发布者、请求用户和权限摘要，并返回一次性激活 URL 和可观察状态。协议 SHALL NOT 把能力缩窄为安装 SKILL 或任何特定业务动作。

#### Scenario: 应用请求本机操作

- **WHEN** 已认证用户在应用中调用 `device.run()`
- **THEN** Server SHALL 创建可审计的 Device Action
- **AND** 返回的状态 SHALL 可由该用户查询或订阅

### Requirement: Scheme 只携带不透明激活票据

激活 URL SHALL 使用版本化 `localapp://action/<id>` Scheme，并且只携带来源 origin、action id、nonce 和协议版本等不透明票据元数据。Scheme SHALL NOT 携带脚本、依赖、凭据、结果或任意文件系统路径。

#### Scenario: 检查激活 URL

- **WHEN** Web 页面收到 Device Action 创建结果
- **THEN** URL SHALL 足以让本机桥向来源 Server claim 请求
- **AND** URL 本身 SHALL NOT 暴露要执行的代码或秘密

### Requirement: 激活只作用于当前电脑的回环桥

原生 Scheme 处理器 SHALL 只把票据转交给当前电脑上回环监听的 Server control 端点。该端点 SHALL 同时要求 loopback 来源和进程控制 token；其它电脑、远程请求或只有票据但没有控制 token 的调用 SHALL 被拒绝。

#### Scenario: 当前电脑接收激活

- **WHEN** 用户在一台电脑上点击安装或执行按钮并触发 Scheme
- **THEN** 只有该电脑的本地 Server SHALL claim 并执行动作
- **AND** 来源 Server SHALL 绑定唯一 installation id，拒绝第二台电脑重复 claim

#### Scenario: 远程伪造 control 请求

- **WHEN** 非回环请求或缺少正确 control token 的请求提交票据
- **THEN** 本地 Server SHALL 返回 401 或 403
- **AND** SHALL NOT claim、信任或执行动作

### Requirement: Server 拥有信任与执行生命周期

来源 Server SHALL 验证应用、发布者、来源 origin、nonce、过期时间和单次 claim。当前电脑的 Server SHALL 展示来源身份、标题、描述、权限及将修改的路径，并负责信任授权/撤销、依赖准备、受限执行、日志、取消、中断恢复和结果回传。原生桥 SHALL NOT 执行业务脚本或自行决定信任。

#### Scenario: 首次发布者或权限扩大

- **WHEN** 当前电脑没有覆盖来源、应用、发布者和所请求权限的信任记录
- **THEN** 动作 SHALL 停在 `awaiting_trust`
- **AND** 本地管理员明确确认后才能执行

#### Scenario: Server 中断执行

- **WHEN** 本地 Server 在准备或运行期间退出
- **THEN** 重启后的状态 SHALL 标记为 interrupted 或可恢复失败
- **AND** 日志和终态 SHALL 保持可审计

### Requirement: 信任严格绑定不可伪造身份与权限超集

本地信任记录 SHALL 以规范化来源 origin、应用所有者与名称、不可变发布者用户 ID 和规范化权限集为边界；显示名 SHALL 只用于展示，不得参与身份判断。只有来源、应用和发布者三元组完全相同，且已授权权限集为新请求权限集的超集时，Server 才可复用信任。

#### Scenario: 相同发布者请求权限子集

- **WHEN** 同一来源、应用和发布者再次请求已授权权限的严格子集
- **THEN** 本地 Server MAY 复用现有信任
- **AND** SHALL 继续按本次较小权限集约束执行

#### Scenario: 身份变化或权限扩大

- **WHEN** 来源 origin、应用所有者/名称或发布者用户 ID 任一变化，或新权限不被已授权权限集完全包含
- **THEN** 动作 SHALL 回到 `awaiting_trust`
- **AND** 发布者显示名相同 SHALL NOT 绕过重新确认

### Requirement: claim 网络请求固定、受限且防止重绑定

本地 Server SHALL 只向票据中经过规范化和策略验证的来源 origin 的固定 claim 路径发请求。请求 SHALL 禁止重定向，不携带 ambient cookie、代理认证或其它环境认证状态，并限制连接/总时长、响应字节数和解析深度。每次连接前 SHALL 重新解析并校验 DNS/目标地址，且实际连接地址 SHALL 仍满足来源策略，避免 DNS 或地址重绑定。

来源策略 SHALL 默认只允许 HTTPS；本地开发 MAY 使用 loopback HTTP；私有网络 HTTP 只有本地管理员显式启用后才可使用。其它明文 HTTP、非 HTTP(S)、userinfo、非 origin 路径、query 和 fragment SHALL 被拒绝。

#### Scenario: 来源尝试重定向或返回超大响应

- **WHEN** claim 端点返回重定向、超过响应预算的数据或解析前后地址不再满足来源策略
- **THEN** 本地 Server SHALL 终止 claim 并报告受控失败
- **AND** SHALL NOT 跟随重定向、执行动作或保存信任

#### Scenario: 明文来源策略

- **WHEN** 票据来源为 loopback HTTP、私有网络 HTTP 或公网 HTTP
- **THEN** loopback HTTP SHALL 只作为本地开发例外被接受
- **AND** 私有网络 HTTP SHALL 仅在本地管理员显式开启后被接受
- **AND** 公网 HTTP SHALL 始终被拒绝

### Requirement: 默认拒绝远程任意脚本静默执行

权限声明 SHALL 使用文件读取、文件写入、网络和子进程等最小能力；执行器 SHALL 按声明限制脚本。来源 origin、nonce 和 action id SHALL 绑定，nonce SHALL 单次使用并过期。任何远程页面 SHALL NOT 仅凭一个脚本正文静默取得当前用户代码执行权限。

#### Scenario: 动作访问未授权资源

- **WHEN** 脚本访问权限声明之外的文件、网络或子进程
- **THEN** 执行器 SHALL 拒绝该访问并报告受限执行错误
- **AND** SHALL NOT 自动扩大权限
