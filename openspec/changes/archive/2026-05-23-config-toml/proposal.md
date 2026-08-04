## Why

Server 的所有配置（PORT、DATA_DIR、JWT_SECRET、TEMPLATE_REPO_URL 等 8 个环境变量）散落在 `process.env` 调用中，没有配置文件。这导致：新人不知道该设什么、DATA_DIR 默认值在 7 个文件中硬编码重复、部分必配项（TEMPLATE_REPO_URL）缺了直接 crash 但没有提示该配什么。CLI 侧的配置目录 `~/.localapp/work/` 也是硬编码的，无法临时切换。

## What Changes

- Server 引入 `config.toml` 配置文件（位于 `{DATA_DIR}/config.toml`），集中管理所有配置项
- Server 配置优先级：环境变量 > config.toml > 内置默认值
- Server 启动时自动加载配置文件，缺失时使用内置默认值继续运行
- Server 将 `process.env` 的散落调用收敛为统一的配置模块，消除 7 处 DATA_DIR 硬编码重复
- Server 启动时对必填项（如 TEMPLATE_REPO_URL）提供更友好的错误提示，指明可通过环境变量或 config.toml 配置
- CLI 新增 `LOCALAPP_CONFIG_DIR` 环境变量支持，可覆盖默认的 `~/.localapp/work/` 配置目录
- Server 新增 TOML 解析依赖（smol-toml 或 toml）

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `server-config`: 扩展服务器配置机制，从纯环境变量升级为"环境变量 > config.toml > 默认值"三级配置体系；CLI 侧增加配置目录可覆盖能力

## Impact

- **packages/server/src/**：新增 `lib/config.ts` 配置加载模块；修改 `index.ts`、`plugins/storage.ts`、`plugins/auth.ts`、`plugins/session.ts`、`routes/serve.ts`、`routes/pages.ts`、`routes/schemas.ts`、`routes/upload.ts`、`routes/admin-serve.ts`、`routes/config.ts`、`routes/admin.ts` 等文件，将 `process.env` 调用替换为统一配置读取
- **packages/server/package.json**：新增 TOML 解析依赖
- **packages/cli/src/config.rs**：修改 `config_path()` 支持 `LOCALAPP_CONFIG_DIR` 环境变量覆盖
- **API 兼容性**：完全向后兼容，环境变量仍可正常使用，config.toml 为可选增强
