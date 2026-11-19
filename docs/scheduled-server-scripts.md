# 服务器定时脚本

服务器运维人员可以登记目录扫描、索引更新等周期任务。LocalApp Server 在后台启动进程，脚本自行判断是否需要调用模型或发布更新。

## 配置任务

在运维控制的目录准备 JSON 文件，设置环境变量 `LOCALAPP_SCHEDULED_SCRIPTS_FILE` 为该文件的绝对路径。也可以在 Server 数据目录的 `config.toml` 中配置 `[server]` 下的 `scheduled_scripts_file`。环境变量优先。重启 Server 后加载配置。

```json
[
  {
    "id": "catalog-scan",
    "executable": "/usr/bin/python3",
    "args": ["/opt/localapp-jobs/scan.py"],
    "cwd": "/opt/localapp-jobs",
    "envFrom": ["PATH", "CATALOG_SOURCE_TOKEN"],
    "timeoutSeconds": 900,
    "schedule": {
      "timeZone": "Asia/Taipei",
      "from": "07:00",
      "until": "23:00",
      "intervalMinutes": 30
    }
  }
]
```

上述任务每天从 07:00 开始，每 30 分钟启动一次，最后一次为 22:30。`until` 是不含的结束时刻，全天窗口使用 `00:00` 至 `24:00`。结束时刻只影响新任务的启动。Server 离线时错过的时点不会补跑，已有运行时也会跳过本次触发。时区的夏令时切换按当地时钟生效。

`executable` 和 `cwd` 必须是绝对路径。Windows 可用 Python 或 Node.js 可执行文件作为入口，将脚本路径放入 `args`。任务默认超时 300 秒，可配置为 1 至 3600 秒。`envFrom` 指定从 Server 环境传递的变量名，系统必需的变量由平台提供。给脚本配置独立的最小权限凭据。

脚本以 Server 操作系统账号执行。使用信任的程序，并让脚本、配置、工作目录及其父目录由运维控制。容器部署可将脚本和配置以只读方式挂载。任务使用前台进程并等待其子进程完成。超时和正常停机时，Server 会尝试终止正在运行的进程树。每个任务的并发限制只在当前 Server 进程内生效，多副本部署应只在一个实例启用同一任务。

## 授权用户与手动运行

管理员使用现有的个人用户组创建专用组，把获授权的账号加入该组，再将组 ID 填入任务的 `groupId`。可从 `GET /api/groups` 获取组 ID。组成员变更会即时生效，只有管理员拥有的非系统组能授予权限。没有组的任务只对管理员可见。

所有任务都可以按配置自动运行。需要手动触发时，将 `manualRunTokenEnv` 设为该任务专用的环境变量名。例如，将其设为 `CATALOG_SCAN_RUN_TOKEN`，再向 Server 提供随机的 Base64URL 字符串，至少 32 字符。仅向有权手动触发的操作员提供这份凭据，并与脚本自己的凭据分开保管。

- `GET /api/system/scheduled-scripts` 使用用户的 `X-API-Key`，返回有权查看的任务、调度配置、运行状态与最近一次结果。结果保存在当前 Server 进程中。
- `POST /api/system/scheduled-scripts/:id/run` 另需 `X-LocalApp-Script-Token`，无需请求体或查询参数。接口在启动时返回 `202`，任务已运行时返回 `409`，未授权任务返回 `404`。手动触发可在时间窗口外执行。

API 返回任务状态，日志由脚本写入运维控制的文件或日志服务。程序路径、脚本参数、环境变量和进程输出均不会随状态返回。
