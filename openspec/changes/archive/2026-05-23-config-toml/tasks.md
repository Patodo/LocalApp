## 1. 基础设施：配置模块与依赖

- [x] 1.1 在 `packages/server/` 安装 `smol-toml` 依赖
- [x] 1.2 创建 `packages/server/src/lib/config.ts`：定义 `ServerConfig` 类型接口，包含所有配置项及默认值；实现 `loadConfig(dataDir)` 函数，从 `{dataDir}/config.toml` 读取并合并（环境变量 > config.toml > 默认值）；对必填项（TEMPLATE_REPO_URL）缺少时抛出含友好提示的错误
- [x] 1.3 为 `lib/config.ts` 编写单元测试：config.toml 不存在时使用默认值、环境变量覆盖、部分字段配置、格式无效时报错、必填项缺失时友好提示
- [x] 1.4 commit: `feat(server): 添加 config.toml 配置加载模块`

## 2. Server 配置注入：消除 process.env 散落

- [x] 2.1 修改 `plugins/storage.ts`：调用 `loadConfig()` 替换 `process.env.DATA_DIR` 和 `process.env.BOOTSTRAP_API_KEY`，将完整配置对象挂载到 `app.config`
- [x] 2.2 修改 `plugins/auth.ts`：从 `app.config` 读取 `DATA_DIR` 和 `BOOTSTRAP_API_KEY`，移除直接 `process.env` 调用
- [x] 2.3 修改 `plugins/session.ts`：从 `app.config` 读取 `JWT_SECRET`，移除直接 `process.env` 调用
- [x] 2.4 commit: `refactor(server): 插件层配置统一从 config 模块读取`

## 3. Server 路由层配置迁移

- [x] 3.1 修改 `routes/serve.ts`：将 `process.env.DATA_DIR` 替换为 `app.config.DATA_DIR`
- [x] 3.2 修改 `routes/pages.ts`：将 `process.env.DATA_DIR` 替换为 `app.config.DATA_DIR`
- [x] 3.3 修改 `routes/schemas.ts`：将 `process.env.DATA_DIR` 替换为 `app.config.DATA_DIR`
- [x] 3.4 修改 `routes/upload.ts`：将 `process.env.DATA_DIR` 替换为 `app.config.DATA_DIR`
- [x] 3.5 修改 `routes/admin.ts`：将 `process.env.DATA_DIR` 替换为 `app.config.DATA_DIR`
- [x] 3.6 修改 `routes/admin-serve.ts`：将 `process.env.ADMIN_STATIC_DIR`、`TEMPLATE_REPO_URL`、`DATA_DIR`、`MIN_CLI_VERSION` 替换为 `app.config` 读取
- [x] 3.7 修改 `routes/config.ts`：将 `process.env.TEMPLATE_REPO_URL`、`GIT_DOWNLOAD_URL` 替换为 `app.config` 读取
- [x] 3.8 修改 `routes/auth.ts`：将 `process.env.JWT_SECRET` 替换为 `app.config` 读取
- [x] 3.9 修改 `index.ts`：将 `process.env.PORT`、`TEMPLATE_REPO_URL` 启动检查替换为统一配置入口
- [x] 3.10 commit: `refactor(server): 路由层配置统一从 config 模块读取`

## 4. CLI 配置目录可覆盖

- [x] 4.1 修改 `packages/cli/src/config.rs`：在 `config_path()` 中检查 `LOCALAPP_CONFIG_DIR` 环境变量，存在时返回 `{LOCALAPP_CONFIG_DIR}/config.json`，否则保持现有 `~/.localapp/work/config.json` 行为
- [x] 4.2 commit: `feat(cli): 支持 LOCALAPP_CONFIG_DIR 环境变量覆盖配置目录`

## 5. E2E 测试：Server 配置

- [x] 5.1 扩展 `tests/e2e/config.test.ts`：config.toml 不存在时服务器使用默认值正常启动，`/api/config` 返回环境变量配置的值
- [x] 5.2 新增 e2e 场景：在 `dataDir` 下写入 config.toml 配置 `template.repo_url`，不设环境变量 `TEMPLATE_REPO_URL`，验证 `/api/config` 返回 toml 中的值
- [x] 5.3 新增 e2e 场景：同时设置环境变量 `TEMPLATE_REPO_URL` 和 config.toml `template.repo_url` 为不同值，验证 `/api/config` 返回环境变量的值（优先级验证）
- [x] 5.4 新增 e2e 场景：写入格式无效的 config.toml，验证 `createTestServer()` 启动失败
- [x] 5.5 适配 `tests/e2e/helpers.ts`：`createTestServer()` 支持可选的 `configToml` 参数，可将配置写入 `{dataDir}/config.toml` 而非仅依赖 `process.env`；现有测试（不传 configToml）保持通过
- [x] 5.6 commit: `test(e2e): 扩展 server config 测试覆盖 config.toml 场景`

## 6. E2E 测试：CLI 配置目录覆盖

- [x] 6.1 新增 `tests/e2e-cli/config-dir.test.ts`：设置 `LOCALAPP_CONFIG_DIR` 指向临时目录并写入 config.json，验证 CLI 从该目录读取 server_url 和 api_key
- [x] 6.2 新增 e2e 场景：`LOCALAPP_CONFIG_DIR` 未设置时 CLI 保持现有行为（读 `~/.localapp/work/config.json` 或使用 `LOCALAPP_SERVER_URL` + `LOCALAPP_API_KEY` 环境变量）
- [x] 6.3 commit: `test(e2e-cli): 添加 LOCALAPP_CONFIG_DIR 覆盖测试`

## 7. 验证与清理

- [x] 7.1 运行全量 e2e 测试，确认所有现有测试通过（配置改造不破坏现有行为）
- [x] 7.2 确认 `packages/server/src/` 中不再有直接的 `process.env` 配置调用（除了 config.ts 内部）
- [x] 7.3 commit: `chore: 验证 config.toml 配置体系完整性`
