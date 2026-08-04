## Context

LocalApp Server 当前所有配置通过环境变量传入，共 8 个环境变量散落在 12+ 处 `process.env` 调用中。`DATA_DIR` 的默认值 `"./data"` 在 7 个文件中硬编码重复。`TEMPLATE_REPO_URL` 为必填项但无默认值，启动时直接 crash 且错误信息不提示可通过何种方式配置。CLI 侧配置目录 `~/.localapp/work/` 硬编码在 `config.rs` 中，无法临时切换到其他目录。

## Goals / Non-Goals

**Goals:**
- Server 引入 `config.toml` 作为主配置源，位于 `{DATA_DIR}/config.toml`
- 统一配置读取入口，消除 `process.env` 散落调用和 `DATA_DIR` 默认值重复
- 保持完全向后兼容：环境变量优先级最高，不设配置文件也能运行
- CLI 支持 `LOCALAPP_CONFIG_DIR` 环境变量覆盖配置目录
- 对必填配置项提供清晰的错误提示（说明可通过环境变量或 config.toml 配置）

**Non-Goals:**
- 不做配置热更新（运行时修改 config.toml 不自动生效，需重启）
- 不做配置文件的自动生成（用户按需手动创建）
- 不做 config.toml 中 `data_dir` 字段覆盖启动时 DATA_DIR 的功能（DATA_DIR 的确定先于配置文件读取）
- 不改变 admin 面板通过 `__ENV__` 注入环境变量的现有机制

## Decisions

### 1. 配置加载方式：统一配置模块

新增 `src/lib/config.ts` 作为唯一配置入口，提供 `loadConfig()` 函数。启动时调用一次，返回不可变配置对象。所有路由和插件通过 Fastify decorate 注入，不再直接读 `process.env`。

**备选方案**：在每个文件中继续读 `process.env` 但改为调用 `getConfig()` — 放弃，因为这仍无法消除重复且难以保证一致性。

### 2. 配置优先级：环境变量 > config.toml > 内置默认值

```
┌─────────────────────────────────────────────────────────┐
│  优先级（从高到低）                                       │
├─────────────────────────────────────────────────────────┤
│  1. 环境变量                                             │
│  2. config.toml                                         │
│  3. 内置默认值                                           │
└─────────────────────────────────────────────────────────┘
```

每个配置项按此顺序查找，找到第一个非空值即使用。

### 3. config.toml 结构

```toml
[server]
port = 3000
data_dir = "./data"

[auth]
jwt_secret = ""
bootstrap_api_key = ""

[template]
repo_url = ""
git_download_url = ""

[admin]
static_dir = ""

[cli]
min_version = ""
```

文件位于 `{DATA_DIR}/config.toml`。`data_dir` 字段仅为文档用途，实际 DATA_DIR 在读取配置文件之前确定（环境变量 > 默认 `"./data"`）。

### 4. TOML 解析库选择：smol-toml

选择 `smol-toml`：零依赖、体积小（~5KB）、符合 TOML 1.0 规范、适合服务端配置解析场景。

**备选方案**：`@iarna/toml`（体积较大）、`toml`（已不维护）。

### 5. DATA_DIR 确定的鸡和蛋问题

启动流程：
1. 从环境变量 `DATA_DIR` 或默认值 `"./data"` 确定数据目录
2. 尝试读取 `{DATA_DIR}/config.toml`
3. 用"环境变量 > config.toml > 默认值"合并得到最终配置
4. config.toml 中的 `server.data_dir` 字段不回写影响步骤 1 的决定

### 6. CLI 配置目录覆盖

修改 `packages/cli/src/config.rs` 的 `config_path()` 方法：
- 检查环境变量 `LOCALAPP_CONFIG_DIR`
- 若存在，返回 `{LOCALAPP_CONFIG_DIR}/config.json`
- 若不存在，保持现有行为 `~/.localapp/work/config.json`

### 7. 配置注入方式：Fastify decorate

在 `storagePlugin` 中扩展 `app.config` 装饰器，加载完整配置对象。其他路由和插件通过 `app.config` 访问配置，不再直接读 `process.env`。

## Risks / Trade-offs

- **[config.toml 不存在时静默使用默认值]** → 合理行为，不影响现有用户。首次使用不需要创建配置文件。
- **[DATA_DIR 内的 config.toml 可能被误删]** → 和其他数据文件（meta.sqlite 等）同等风险，无需特殊处理。
- **[新增 smol-toml 依赖]** → 依赖极轻量，维护活跃，风险低。
- **[config.toml 中明文存储 JWT_SECRET]** → 与环境变量明文风险相同，生产环境应通过环境变量注入敏感值。
