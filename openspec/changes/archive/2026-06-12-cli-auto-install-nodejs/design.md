## Context

当前 CLI 的 `pm::check_available()` 检测到 Node.js/npm 缺失时直接报错退出。用户必须自行安装 Node.js 后才能使用 `localapp init`、`localapp dev`、`localapp upload` 等命令。本次变更让 CLI 能主动帮助用户完成 Node.js 安装。

## Goals / Non-Goals

**Goals:**
- CLI 检测到缺 Node.js 时，优先从 server 下载安装包并启动安装向导
- Server 可选托管 Node.js 安装包，通过公开 API 分发
- Server 未托管时优雅降级，提示用户手动安装
- 仅支持 Windows 平台

**Non-Goals:**
- 不支持 macOS / Linux 的自动安装
- 不做 Node.js 版本选择或管理（固定一个 LTS 版本）
- 不做静默安装（用户必须手动完成安装向导）
- 安装完成后不自动重试原命令（提示用户重新运行）

## Decisions

### 1. Server 端存储结构

复用 CLI 分发的模式，在 `static/deps/` 下存放 Node.js 安装包：

```
packages/server/static/deps/
├── node.json          ← { "version": "22.16.0", "platforms": { ... } }
└── node/
    └── 22.16.0/
        └── node-v22.16.0-x64.msi
```

`node.json` 描述可用版本和平台，与 `cli/versions.json` 结构一致。Server 管理员只需放入 `.msi` 文件并更新 `node.json`。

**理由**：复用已有的分发模式，零额外基础设施。

### 2. Server 路由设计

新增公开路由（无需鉴权，与 CLI 下载一致）：

- `GET /api/deps/node` → 返回 `node.json` 内容（版本和平台信息）
- `GET /api/deps/node/download?os=windows&arch=x86_64` → 流式返回 `.msi` 文件，带 `Content-Disposition`

**理由**：与 `/api/cli/version` 和 `/api/cli/download` 保持一致的模式。

### 3. CLI 自动安装流程

`pm::check_available()` 检测到 npm/pnpm 不可用时：

1. 使用已保存的 `server_url`（来自 `localapp login`）请求 `GET /api/deps/node`
2. 如果 server 返回 200 且有 Windows 平台 → 下载 `.msi` 到临时目录
3. 用 `ShellExecuteW("open", path_to_msi)` 弹出安装向导
4. 等待安装进程结束后提示用户重新运行命令
5. 如果 server 返回 404 或请求失败 → 打印 nodejs.org 下载链接

**理由**：`ShellExecuteW("open")` 是 Windows 上启动安装向导的标准方式，等同于用户双击 `.msi` 文件。

### 4. 下载进度展示

使用 `reqwest` 流式下载，通过 `content-length` 计算进度百分比，在终端显示简单进度条。

**理由**：Node.js 安装包 ~30MB，需要进度反馈让用户知道在等待什么。

## Risks / Trade-offs

- [管理员权限] → `.msi` 安装可能触发 UAC 提示，用户需要确认。这是 Windows 标准行为，不特殊处理。
- [安装后 PATH 不生效] → 当前终端 session 的 PATH 不会更新。提示用户关闭重开终端，或重新运行命令。不尝试自行刷新 PATH。
- [磁盘空间] → 临时目录中的 `.msi` 安装完成后删除。
