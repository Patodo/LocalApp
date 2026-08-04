## Context

init-repo 模板的 Vite dev server 运行在 `localhost:5173`，SDK 的 basePath 在本地环境下解析为 `/api`，但本地没有 LocalApp 服务器响应请求。需要在本地开发时将 API 请求代理到 LocalApp 服务器。

## Goals / Non-Goals

**Goals:**
- `npm run dev` 时 SDK 的所有 API 调用（`/api/me`、`/serve/{userId}/{name}/api/*`）能正常工作
- 服务器地址由 `localapp init` 自动注入，用户无需手动配置
- 代理配置不影响生产构建

**Non-Goals:**
- 不做热更新或 WebSocket 代理
- 不修改 SDK 源码
- 不支持离线开发

## Decisions

### D1: 使用 .localapp/dev-config.json 存储服务器地址

**选择**：init 命令在项目目录下创建 `.localapp/dev-config.json`，包含 `{ "serverUrl": "http://..." }`。

**替代方案**：直接写入 `.env.development` 环境变量文件。

**理由**：
- `.localapp/` 目录是项目级 LocalApp 配置的自然归属
- JSON 格式可扩展（未来可能加入更多配置）
- 与 manifest.json 分离（manifest 是版本控制的，dev-config 是本地的）
- .gitignore 排除，不会泄露服务器地址

### D2: vite.config.ts 使用 try/catch 读取配置

**选择**：vite.config.ts 用 `fs.readFileSync` 读取 `.localapp/dev-config.json`，读取失败时使用空 proxy 配置（不报错）。

**理由**：
- 模板仓库里没有 `.localapp/dev-config.json`（git clone 后需要 init 才写入）
- 容错处理避免直接 clone 模板时 vite 启动报错
- 没有 proxy 时 API 调用会正常失败，用户看到网络错误而非配置错误

### D3: CLI init 在 git clone 和 manifest.json 之后写 dev-config

**选择**：在 init 流程的最后一步，读取 CLI 配置中的 `server_url`，写入 `.localapp/dev-config.json`。

**理由**：
- 顺序自然：clone → remove remote → manifest → dev-config
- `server_url` 已在 config 中，无需额外请求
- 配置文件路径跟随 `server_url`，如果用户配置的是 `http://192.168.1.100:3000`，proxy 就指向这个地址

## Risks / Trade-offs

**[服务器地址变更]** → 如果 LocalApp 服务器迁移，用户需要手动更新 `.localapp/dev-config.json` 或重新 init。风险低，因为这是内网项目。可接受。
