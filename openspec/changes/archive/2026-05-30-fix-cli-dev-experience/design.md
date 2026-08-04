## Context

端到端测试揭示了 CLI 开发工作流的两个阻塞性问题：

1. **CLI 二进制未重编译**: Phase 6 新增的 `dev`、`generate`、`whoami`、`logout` 命令仅存在于源码，安装的二进制不包含它们
2. **本地开发 API 路由断裂**: `detectBasePath()` 依赖 `window.location.pathname` 匹配 `/serve/{user}/{page}` 来构建 API 路径。本地 Vite dev server 运行在 `localhost:5173`，pathname 不包含此结构，回退到 `/api`。服务端收到 `/api/bugs` 后无法确定是哪个 page 的数据，返回 404

当前 `.localapp/dev-config.json` 仅含 `serverUrl`，Vite 代理原样转发 `/api/*` 请求。

## Goals / Non-Goals

**Goals:**
- 本地开发时 CRUD API 能正常工作（浏览器 `fetch("/api/bugs")` → Vite 改写 → 服务端正确路由）
- `localapp dev`、`generate`、`whoami`、`logout` 命令在用户机器上可用
- `init --skip-deploy` 仍然安装 npm 依赖

**Non-Goals:**
- 不修改 SDK 的 `detectBasePath()` 逻辑
- 不修改服务端路由结构
- 不引入新的 npm 包或外部依赖

## Decisions

### 1. Vite 代理路径改写 (而非 SDK 基路径注入)

**选型**: 让 Vite 代理在转发前改写路径：`/api/bugs` → `/serve/{user}/{page}/api/bugs`

**备选**: 让 SDK 读取配置文件覆盖 `detectBasePath()` 返回值

**理由**: Vite 代理改写对 SDK 完全透明，SDK 行为在生产环境和本地开发中保持一致。修改 SDK 需要发布新版本、更新所有引用方，而代理改写只需改 init 模板。

**dev-config.json 新结构:**
```json
{
  "serverUrl": "http://localhost:3000",
  "userId": "demo",
  "pageName": "bugreport"
}
```

### 2. CLI dev 命令注入上下文

`localapp dev` 在启动 `npm run dev` 前：
1. 读 manifest.json 获取 pageName（已有逻辑）
2. 从 CLI 配置推断 userId（优先用已登录用户，否则用当前系统用户名）
3. 写 `.localapp/dev-config.json`
4. 执行 `npm run dev`

userId 推断策略：优先读取 `config.json` 中的用户名（如果之前执行过 `whoami`），否则使用当前 OS 用户名作为默认值。用户可手动编辑 dev-config.json 修改。

### 3. --skip-deploy 拆分

`init` 命令新增 `--skip-install` 标志：
- `--skip-install`: 跳过 `npm install`（用于离线或手动安装场景）
- `--skip-deploy`: 跳过部署步骤（注册 page、构建、上传），但仍然安装依赖

原有行为（`--skip-deploy` 跳过安装）不再保留。

### 4. CLI 二进制编译和安装

在 monorepo 根目录执行：
```bash
cd packages/cli && cargo build --release && cp target/release/localapp ~/.local/bin/
```

## Risks / Trade-offs

- **userId 推断不准**: 默认 OS 用户名可能与服务端用户名不一致 → 用户可手动编辑 dev-config.json 修正
- **init 模板向后兼容**: 旧版 Vite 配置不读取 pageName → 无影响，`dev-config.json` 缺少字段时代理退化为原样转发
- **路径改写仅覆盖 `/api/*`**: `/serve/*` 代理保持不变，用于静态文件请求（如图片）直接转发
