## Purpose

定义 npm 安装的唯一 `localapp` CLI 与 Server 的版本兼容、registry 版本发现、升级提示和 daemon release 切换，禁止下载后自替换 executable。

## Requirements

### Requirement: Server 校验 CLI 版本

Server SHALL 校验 CLI 请求的 `X-CLI-Version`。低于最低兼容版本时 MUST 返回稳定错误，
并提示用户通过 npm 更新 `localapp` 包；普通浏览器请求不受 CLI header 要求影响。

#### Scenario: 版本满足要求

- **WHEN** 请求携带兼容的 `X-CLI-Version`
- **THEN** 请求 SHALL 正常处理

#### Scenario: 版本过低

- **WHEN** CLI 版本低于 Server 最低兼容版本
- **THEN** Server SHALL 返回 403 和最低版本
- **AND** 错误 SHALL 提示 `npm update --global localapp`

#### Scenario: 未设置最低版本

- **WHEN** Server 未配置最低 CLI 版本
- **THEN** SHALL 跳过该兼容门禁

### Requirement: npm registry 是升级来源

CLI SHALL 从自身 npm package version 得到当前版本。`localapp update` MAY 查询 registry
并打印精确的 npm 更新命令，但 SHALL NOT 下载、自替换或重命名当前 executable。

#### Scenario: 发现新版本

- **WHEN** `localapp update` 查询到更高兼容版本
- **THEN** CLI SHALL 输出 `npm install --global localapp@<version>`
- **AND** SHALL 保持当前安装不变

#### Scenario: 已是最新版本

- **WHEN** 当前 package version 等于最新版本
- **THEN** CLI SHALL 输出已是最新版本且不修改文件

#### Scenario: registry 不可用

- **WHEN** registry 查询失败
- **THEN** CLI SHALL 返回可操作错误且 daemon/Server SHALL 继续运行当前版本

### Requirement: CLI 请求携带 npm package version

CLI Client SHALL 在程序化 Server 请求中附带 `X-CLI-Version`，值为已安装 `localapp`
package 的语义版本。

#### Scenario: 请求附带版本 header

- **WHEN** CLI 发出需要版本协商的 HTTP 请求
- **THEN** header SHALL 等于当前 npm package version

### Requirement: daemon 升级通过 npm 包切换

npm 更新后，下一次 `localapp server` SHALL 让用户服务切换到新包构建的 release，并在
readiness 成功后提交；失败 SHALL 保留最后可用 release。native adapter 必须与所选
release 的 artifact manifest 和摘要一致。

#### Scenario: 新版本 daemon 启动成功

- **WHEN** 用户更新 npm 包后执行 `localapp server`
- **THEN** service SHALL 使用新 package release 并报告新版本

#### Scenario: 新版本 readiness 失败

- **WHEN** 新 release 无法完成 readiness
- **THEN** service SHALL 回退最后可用 release且不破坏数据目录
