# 远端局域网 Server 与应用同步验收设计

## 目标

在局域网主机 `192.168.2.9` 上通过 npm 安装正式发布的
`@patodo/localapp@0.1.0`，以前台进程运行统一 Server，开发并上线一个新应用，随后从本机
独立 Server 向远端同步两款现有测试应用。整个流程验证 npm 交付、局域网 Server、应用开发、
应用发布、对等端同步以及应用加数据同步均能脱离源码仓库工作。

## 环境与目录

- 远端：`root@192.168.2.9`，Ubuntu 24.04 x64。
- 远端尚无 Node.js；安装 Node.js 24 和 npm 后，全局安装 `@patodo/localapp@0.1.0`。
- 远端所有本次数据位于 `/root/localapp/`：
  - `server-data/`：统一 Server 数据；
  - `apps/device-notes/`：新应用源码；
  - `logs/server.log`：Server 完整日志；
  - `tmp/`：明确的远端验收临时文件。
- 本机源 Server 的数据和测试产物继续位于本仓库 `tmp/remote-lan-acceptance/`。
- 不使用系统 `/tmp`，不安装 systemd 服务，不引入第二套后端。

## Server 运行方式

远端运行正式 npm CLI：

```bash
localapp server run \
  --data-dir /root/localapp/server-data \
  --host 0.0.0.0 \
  --port 49813
```

进程由持久 SSH 会话启动，stdout/stderr 同时写入 `/root/localapp/logs/server.log`。验收期间不依赖
systemd，便于直接查看启动、请求和错误日志。局域网正式入口为
`http://192.168.2.9:49813/`。若 UFW 已启用，只允许 `192.168.2.0/24` 访问 TCP 49813；
若 UFW 未启用，不额外改变整机防火墙策略。

远端完成首次管理员初始化并创建一枚本次验收专用 API Key。本机源 Server 使用独立用户、
数据库和 API Key，证明两个 Server 是对等且数据隔离的实例。

## 新应用：device-notes

`device-notes` 使用 npm 包内置模板创建，业务模型为局域网设备备忘录：

- 字段：标题、设备名称、内容、状态、创建者、创建时间、更新时间；
- 状态：`open` 与 `done`；
- 功能：列表、关键词搜索、状态过滤、新增、编辑、完成/重新打开、删除确认；
- 权限：普通用户只管理自己创建的记录，管理员可以查看和管理全部记录；
- 后端：migration 与 named SQL/backend contract，由统一 Server 执行；
- 前端：React + TypeScript，使用 LocalApp SDK，不实现应用私有服务。

应用在远端源码目录完成 `npm install`、测试、构建和 `localapp check --json`，随后通过远端
profile/API Key 安装到同一远端 Server。正式 `/<owner>/device-notes/` URL 必须完成 CRUD、
搜索、过滤和权限验收。

## 对等端同步

本机在 `tmp/remote-lan-acceptance/` 中启动一个独立源 Server，安装仓库中的：

- `examples/skill-market`；
- `examples/resume-manager`。

远端 Server 创建验收 API Key；该 Key 对应用户成为远端同步应用的所有者。本机源 Server
将 `http://192.168.2.9:49813` 配置为显式允许不安全 HTTP 的局域网 peer，凭据只存储在
源 Server 的加密 peer store 中。

同步分两条路径：

1. `skill-market` 执行应用版本同步，只同步应用包、manifest、migration 和 backend contract，
   不同步数据库、文件、用户或权限。
2. `resume-manager` 先在源端创建一条测试简历记录并上传一份 PDF 与一张图片，再执行
   `--with-data --confirm-app resume-manager`。目标端先自动备份，然后整体替换该应用数据库
   与文件；用户、权限及平台数据仍不替换。

同步后核对应用名称不变、远端所有者正确、同步任务完成、附件字节一致，并验证远端正式
应用页面中的 PDF/图片预览和下载。

## 验证与故障处理

- npm：从 registry 安装，验证 `localapp --version` 为 `0.1.0`。
- Server：从本机请求远端 `/health`、`/setup`/登录页和 Web 管理入口。
- 应用：三款应用均从正式 `/<owner>/<app>/` URL 验收，不以 `/serve/` 代替。
- 同步：记录 source/target job 状态；失败时读取两端日志，不绕过原子安装或回滚流程。
- 数据同步：同步前后计算上传文件 SHA-256；失败必须确认目标端仍为原版本和原数据。
- 生命周期：显式停止远端前台进程后再次启动同一命令，验证 Server 数据与三款应用仍存在。

浏览器功能验收使用应用内 Browser。SSH、npm、构建、日志和进程状态使用命令行验证。

## 完成标准

1. `192.168.2.9:49813` 可从本机局域网访问，完整登录和权限生效。
2. `device-notes` 在远端完成创建、安装和核心业务交互。
3. `skill-market` 通过应用版本同步出现在远端，源端业务数据不随之复制。
4. `resume-manager` 通过显式应用加数据同步复制记录和附件，文件摘要一致。
5. 两端用户、权限及平台数据保持独立。
6. 远端 Server 停止并重启后，以上应用和数据仍可访问，日志足以定位整个流程。
