## Context

当前 CLI 通过 HTTP 与 Server 通信，但没有版本感知能力。CLI 编译时携带 `Cargo.toml` 版本号，但运行时不会发送给 Server。Server 升级后 API 变更，旧 CLI 连接时可能收到无法理解的错误，用户无恢复手段。

约束：
- CLI 是 Rust 编译的二进制文件，运行在 Windows/Linux/macOS
- Server 是 Node.js/Fastify，自托管部署
- 更新必须是强制的（管理员控制最低版本）
- 不给用户确认提示，直接阻断 + 引导更新

## Goals / Non-Goals

**Goals:**
- Server 能拒绝过旧的 CLI 请求，返回明确错误
- CLI 能通过 `update` 命令从 Server 下载最新二进制并自替换
- 管理员通过单一配置项（环境变量）控制最低兼容版本
- `update` 命令和下载端点不受版本检查拦截

**Non-Goals:**
- 不实现增量更新（每次下载完整二进制）
- 不实现自动后台检查（仅在执行命令时按需触发）
- 不实现回滚（用户可手动下载旧版）
- 不实现跨版本兼容矩阵（仅 min 版本单点判断）

## Decisions

### 1. 版本号传递方式：HTTP Header `X-CLI-Version`

端口、URL 参数、请求体等方式都会污染业务逻辑。Header 是标准做法，与现有 `X-API-Key` 一致。

**替代方案**: 在 User-Agent 中携带 → 语义不清晰，解析不便。

### 2. 版本号来源：编译时 `env!("CARGO_PKG_VERSION")`

编译时嵌入，零运行时开销，与 Cargo.toml 保持同步。唯一缺点是修改版本号需要重新编译——但这本来就是发布流程的一部分。

**替代方案**: 运行时读 package.json → CLI 没有这样的文件，且 Rust 生态中用 Cargo.toml 是惯例。

### 3. 版本检查位置：auth hook 内

在 `onRequest` 中，API Key 验证通过后、业务逻辑之前，检查 `X-CLI-Version`。这样复用现有的 auth scope 结构，不需中间件链改造。

Update 路由需要绕过版本检查——通过在独立的 auth scope 中注册（不注册版本检查 hook）。

### 4. 最低版本配置：环境变量 `MIN_CLI_VERSION`

管理员在部署/升级 Server 时设置。改这个值立即生效（Fastify 每次请求读取，或启动时读入）。简单、无状态。

**替代方案**: 写入 versions.json → 多一层文件 IO，且 versions.json 需要同时管理二进制和版本策略，职责不清。

### 5. 二进制存放：`static/cli/` 目录

```
static/cli/
├── versions.json          ← 版本清单
├── 0.1.0/
│   ├── localapp-cli-x86_64-pc-windows-msvc.exe
│   ├── localapp-cli-x86_64-unknown-linux-gnu
│   └── localapp-cli-aarch64-apple-darwin
└── 0.2.0/
    └── ...
```

`versions.json` 结构：
```json
{
  "min": "0.2.0",
  "latest": "0.2.0",
  "versions": {
    "0.1.0": { "released": "2026-05-01" },
    "0.2.0": { "released": "2026-05-20" }
  }
}
```

`/api/cli/version` 返回这份 JSON。`/api/cli/download` 默认下载 `latest`，也支持 `?version=0.1.0` 指定版本。

### 6. 自替换策略

| 平台 | 策略 |
|------|------|
| Windows | rename 当前 exe → `localapp-cli.old.exe`，move 新文件到原路径。下次启动时清理 `.old` |
| Linux/macOS | rename 旧文件，move 新文件到原路径，设置可执行权限 |

Windows 上不能删除运行中的 exe，但可以 rename。rename + move 的方案简单可靠。

## Risks / Trade-offs

- **网络不可用时无法更新** → update 命令失败时给出明确提示和二进制下载 URL，用户可手动下载
- **下载中断导致残留** → 先写 `.download` 临时文件，完整写入后再 rename
- **旧 CLI 无 version header 被全部拒绝** → 首次部署时 `MIN_CLI_VERSION` 可设为 `0.0.0` 过渡，确认大部分用户升级后再设实际值
- **二进制体积较大** → 每次 update 下载完整文件，但 Rust 编译产物通常 < 20MB，可接受

## Open Questions

- `static/cli/` 下的二进制文件由谁放入？建议由 CI/CD pipeline 在构建时自动放置，或手动上传。本变更只在 Server 侧搭好目录结构和读取逻辑。
