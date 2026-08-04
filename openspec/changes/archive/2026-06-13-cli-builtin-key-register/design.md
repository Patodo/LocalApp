## Context

当前 `auth-registration-control`（已归档）实现了配置驱动的 CLI 静默注册：部署者在 `config.toml` 中设置 `registration_key`，CLI 通过 `--registration-key` 参数传入。但这套机制存在两个摩擦点：

1. **部署者不知道要配** — `.env.example` 完全没提 `REGISTRATION_KEY`，key 默认为空等于功能关闭
2. **CLI 用户必须传参** — 新员工首次使用必须知道 key 值并手动传入，无法零参数完成

同时，浏览器注册通道（`POST /api/auth/register` + `/register` 页面）仍然存在，与"企业内部、仅 CLI 接入"的定位不符。

本变更将 key 从"可配凭证"升级为"构建时锁定的内置标识"，关闭浏览器注册，让 CLI 真正零摩擦。核心约束：monorepo 中 Rust CLI 和 Node.js server 是独立构建的，必须共享同一个 key。

## Goals / Non-Goals

**Goals:**

- CLI 用户执行 `localapp login`，输入 server URL 后自动完成注册，零参数零摩擦
- 浏览器无法注册，外部人员无任何自助注册途径
- key 作为客户端标识内置在 CLI binary 和 server 中，构建时锁定，不可配置
- dev 和 prod 构建共用同一套共享文件机制，无需分别处理
- Docker 镜像打包时自动包含正确的 key

**Non-Goals:**

- 不实现 key 轮换或撤销机制（key 泄露的代价可接受，靠 admin 删除非法用户兜底）
- 不实现 admin 手动创建用户 API（另一变更负责）
- 不修改 `auto_register_pattern` 默认值（保持 `^[a-z][a-z0-9_]*$`，开发环境自行配置）
- 不修改 admin 浏览器登录流程（`admin_default_password` + 强制改密保持不变）
- 不实现 OAuth / SSO 等外部认证

## Decisions

### D1: 共享文件作为唯一真相源

新增 `packages/shared/.registration-key`（gitignored），存储一行随机字符串。CLI 和 server 都从这个文件读取 key。

**文件位置选择**：放在 `packages/shared/` 而非仓库根目录，因为 `shared` 包本来就是跨包共享资源的语义位置，且 server 和 CLI 都已经依赖该目录结构。

**生命周期**：
- 首次开发：`pnpm setup`（或 `postinstall` 钩子）检测文件不存在 → 生成 32 字节随机 hex 字符串写入
- 发版构建：CI 读取已有文件（或为每个 release 生成新文件）
- Docker 打包：`Dockerfile` 中 `COPY packages/shared/.registration-key` 进镜像

**替代方案**：
- 固定 dev key + CI 注入 prod key → 两套机制增加复杂度，dev/prod 行为不一致
- 环境变量传递 → CLI 是编译型 binary，无法在用户机器上读运行时环境变量
- key 写入 server meta.sqlite → meta.sqlite 是运行时数据库，构建时写入不合理

### D2: CLI 编译时注入 — build.rs + env!()

Rust 侧通过 `build.rs` 在编译时读取共享文件，设置 `cargo:rustc-env=REGISTRATION_KEY=xxx`，源码中用 `env!("REGISTRATION_KEY")` 编译为常量。

```rust
// build.rs
fn main() {
    let key = std::fs::read_to_string("../../packages/shared/.registration-key")
        .expect("registration key file missing; run pnpm setup");
    println!("cargo:rustc-env=REGISTRATION_KEY={}", key.trim());
    println!("cargo:rerun-if-changed=../../packages/shared/.registration-key");
}

// login.rs
const REGISTRATION_KEY: &str = env!("REGISTRATION_KEY");
```

**路径处理**：`build.rs` 中使用相对路径指向 monorepo 根的共享文件。由于 CLI crate 在 `packages/cli/`，相对路径为 `../../shared/.registration-key`（从 `packages/cli/` 出发）。

**替代方案**：
- `include_str!()` → 路径相对于源文件，跨平台脆弱
- 运行时读取文件 → 用户机器上没有该文件，binary 无法分发
- 编译时环境变量（`REGISTRATION_KEY=xxx cargo build`）→ 容易忘记设置，构建不可复现

### D3: Server 启动时读取共享文件

`config.ts` 的 `loadConfig` 中增加从共享文件读取 `registrationKey` 的逻辑：

```typescript
async function readSharedRegistrationKey(): Promise<string> {
  const keyPath = path.join(__dirname, "../../../shared/.registration-key");
  try {
    return (await fs.promises.readFile(keyPath, "utf-8")).trim();
  } catch {
    return ""; // 文件不存在时 key 为空，cli-register 端点将拒绝所有请求
  }
}
```

key 不再从 `config.toml` 或环境变量读取，配置项 `registration_key` 和 `allow_register` 从 `ServerConfig` 接口中删除。

**替代方案**：
- Docker 启动时通过环境变量传入 → 需要额外编排，且与 dev 流程不一致
- 写入 meta.sqlite → D1 已否决

### D4: 新增 `POST /api/auth/cli-register` 端点

不复用现有 `/register` 路径（语义混淆），新增专用端点：

```
POST /api/auth/cli-register
Headers: X-Registration-Key: <built-in-key>
Body: { username: "os-username" }
```

逻辑：
1. 校验 `X-Registration-Key` 与内置 key 匹配 → 不匹配返回 403
2. 校验 `username` 匹配 `auto_register_pattern` → 不匹配返回 403
3. 用户已存在 → 返回 409
4. 创建用户（固定密码 `localapp`，`must_change_password=1`）+ 生成 API Key → 返回 `{ success: true, data: { apiKey } }`

**与现有 `/register` 的差异**：不接受请求中的 password（固定 `localapp`）、不接受无 key 的浏览器注册、无 `allow_register` 开关。

### D5: 移除浏览器注册 — 删除而非禁用

直接删除 `/register` 页面、`POST /api/auth/register` 端点、3 处导航链接。不保留"禁用"状态，避免半废弃代码。

**删除清单**：
- `packages/web/app/(auth)/register/page.tsx` — 整个文件
- `packages/web/app/(auth)/login/page.tsx` 第 117 行 — `/register` 链接
- `packages/web/components/shell/navbar.tsx` 第 87 行 — `/register` 链接
- `packages/web/app/(dashboard)/page.tsx` 第 536 行 — `/register` 链接
- `packages/server/src/routes/serve.ts` 第 86 行 — `/register` 路由
- `packages/server/src/routes/auth.ts` 第 15-60 行 — `POST /api/auth/register` 端点

### D6: CLI login 零参数自动注册

`login.rs` 的 `run` 函数改为：

1. 若 `--server-url` + `--api-key` 均提供 → 非交互式保存（保留现有行为）
2. 交互式输入 server URL
3. 若无现有配置或 api_key 为空 → 用内置 key + OS 用户名调用 `POST /api/auth/cli-register`
   - 成功 → 保存 api_key，完成
   - 409（已存在）→ 回退手动输入 api_key
   - 403（key 无效或 pattern 不匹配）→ 回退手动输入 api_key
   - 其他错误 → 回退手动输入 api_key
4. 回退路径：交互式输入 api_key（保留现有 Password 对话框）

移除 `--registration-key` CLI 参数及 `main.rs` 中对应的 clap 定义。

### D7: 测试迁移 — createTestUser helper

新增 `tests/helpers/createUser.ts`，封装通过 `cli-register` 端点（带内置 key）创建测试用户的逻辑：

```typescript
export async function createTestUser(baseUrl: string, username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/cli-register`, {
    method: "POST",
    headers: { "X-Registration-Key": getBuiltInKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const body = await res.json();
  return body.data.apiKey;
}
```

`getBuiltInKey()` 从共享文件读取（与 server 同源）。30+ 个测试文件批量替换 `POST /api/auth/register` 调用为 `createTestUser()`。

`register-control.test.ts` 重写为针对 `/cli-register` 的测试。

## Risks / Trade-offs

- **[key 泄露后无防护]** → 代码不公开，key 编译进 binary；即使泄露，pattern 仍限制用户名格式；admin 可手动删除非法用户。可接受。
- **[CLI 和 server 版本不一致]** → 若用户用了旧 CLI 连新 server（或反之），key 对不上，自动注册失败。缓解：CLI 回退手动输入 api_key；version check 机制已存在。
- **[共享文件路径在 Docker 中变化]** → Dockerfile 中需正确 COPY 文件到 server 运行时能找到的路径。缓解：构建时将 key 写入 server 镜像内的固定路径（如 `/app/.registration-key`），server 优先读该路径。
- **[build.rs 路径跨平台脆弱]** → Windows 上路径分隔符不同。缓解：`build.rs` 中用 `std::path::PathBuf` 拼接，或通过环境变量 `CARGO_MANIFEST_DIR` 计算绝对路径。
- **[首次 clone 后忘记跑 setup]** → `pnpm install` 不会生成 key 文件，`cargo build` 会因文件缺失而失败。缓解：将 key 生成挂在 `pnpm setup` 或 `postinstall` 钩子；CI 中显式调用。
- **[测试大量改动]** → 30+ 文件迁移，工作量大但机械。缓解：先写 helper，再批量替换。
