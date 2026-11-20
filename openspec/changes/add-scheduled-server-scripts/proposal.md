## Why

定期扫描和索引更新通常由确定性脚本完成。把每次检查交给 Agent 会增加模型请求，也会让脚本是否执行依赖于对话运行状态。统一 Server 需要支持由运维登记的后台脚本，并允许管理员明确授权用户操作指定任务。

## What Changes

- 统一 Server 加载运维配置，按本地时区与每日窗口启动脚本。
- 通过管理员拥有的专用用户组控制任务可见性及手动触发权限。
- 手动触发须由运维为任务启用，并验证独立的任务凭据。
- 提供任务运行状态、超时和同实例防重入。

## Capabilities

### New Capabilities

- `scheduled-server-scripts` 提供可信脚本登记、调度与授权接口。

### Modified Capabilities

无。

## Impact

改动涉及统一 Server 的启动配置、生命周期及 API。功能默认关闭，现有应用包和数据无需迁移。
