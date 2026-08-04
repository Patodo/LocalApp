## Context

当前 LocalApp 的 AI 集成通过 TypeScript MCP stdio client（`packages/mcp-client`）实现。该 client 依赖 Node.js 运行时，打包分发需要处理 npm 依赖、跨平台兼容等问题。企业内部使用场景下，一个零依赖的单文件二进制更合适。

现有 server 已提供完整的 HTTP API（`/api/upload`、`/api/pages`、`/api/schemas`），CLI 本质上是这些 API 的客户端。唯一缺失的是 `POST /api/pages`（创建空页面），需要新增。

## Goals / Non-Goals

**Goals:**

- 用 Rust 编写 CLI 工具，编译为单个二进制文件
- 支持三平台：Windows、macOS（Intel + Apple Silicon）、Linux
- 所有命令输出 JSON，方便 Claude Code 解析
- 配置管理：`~/.localapp/work/config.json` 持久化 + 环境变量覆盖
- 项目级 `.localapp.json` 自动管理（`new` 命令生成，`upload` 命令读取）
- 服务端新增 `POST /api/pages` 端点

**Non-Goals:**

- 不支持 MCP 协议（stdio 或 SSE）
- 不做交互式 TUI，只做命令行子命令
- 不做自动更新机制
- 不做 CI/CD 发布流程（手动 `cargo build --release` 即可）

## Decisions

### 1. Rust CLI 替代 TypeScript MCP client

**选择**: Rust 单二进制

**替代方案**: Go（也能单二进制，但 Rust 生态中 reqwest/clap/serde 更成熟）、Node.js pkg 打包（产物大、兼容性问题）

**理由**: Rust 编译产物小（~5MB）、启动快、无运行时依赖。三平台交叉编译成熟。

### 2. CLI 命令设计

```
localapp login                    # 交互式配置 serverUrl + apiKey
localapp new                      # 创建新页面，写入 .localapp.json
localapp upload <path>            # 上传目录（读 .localapp.json）
localapp pages list               # 列出所有页面
localapp pages info [pageId]      # 页面详情（默认读 .localapp.json）
localapp pages delete [pageId]    # 删除页面（默认读 .localapp.json）
localapp schemas create <name> --fields <json> [pageId]  # 创建 schema
localapp schemas list [pageId]    # 列出 schemas
localapp schemas delete <name> [pageId]  # 删除 schema
```

- `upload` 不接受 `--page-id` 参数，强制从 `.localapp.json` 读取
- 其他命令的 `[pageId]` 参数可选，默认从 `.localapp.json` 读取

### 3. 配置优先级

```
环境变量 > ~/.localapp/work/config.json > 项目级 .localapp.json（仅 pageId）
```

环境变量：`LOCALAPP_SERVER_URL`、`LOCALAPP_API_KEY`

### 4. Rust 依赖选型

- **clap** (derive): CLI 参数解析
- **reqwest** (multipart feature): HTTP 请求 + 文件上传
- **serde / serde_json**: JSON 序列化
- **tokio**: async runtime
- **dialoguer**: `login` 命令的交互式输入

### 5. 项目结构

在 `packages/mcp-client/` 下替换为 Rust 项目：

```
packages/mcp-client/
├── Cargo.toml
├── src/
│   ├── main.rs          # CLI 入口 + clap 定义
│   ├── config.rs        # 配置读写
│   ├── client.rs        # HTTP API 客户端
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── login.rs     # login 命令
│   │   ├── new.rs       # new 命令
│   │   ├── upload.rs    # upload 命令
│   │   ├── pages.rs     # pages 子命令
│   │   └── schemas.rs   # schemas 子命令
│   └── project.rs       # .localapp.json 读写
├── tests/               # 集成测试
└── Cross.toml           # 交叉编译配置（可选）
```

### 6. 服务端变更

仅新增 `POST /api/pages` 路由到 `pagesRoutes`：

```typescript
app.post("/api/pages", async (req, reply) => {
  // 生成 pageId，创建目录和 meta.json，返回 pageId
});
```

### 7. Claude Code Skill

在 `.claude/skills/localapp.md` 中编写 skill，指导 AI：
- 使用 `localapp` CLI 执行操作
- 读 `.localapp.json` 获取项目上下文
- 直接调用 HTTP API 作为 fallback

## Risks / Trade-offs

- **[Rust 编译环境]** → 团队成员需要安装 Rust 工具链来构建。可通过预编译二进制分发给非开发人员。
- **[交叉编译]** → macOS/Linux 交叉编译可能需要额外配置。可用 cross-rs 或 GitHub Actions 简化。
- **[删除 MCP client]** → 现有 MCP e2e 测试需要删除，改为测试新的 `POST /api/pages` 端点。不影响 CRUD 和 schema 的测试。
