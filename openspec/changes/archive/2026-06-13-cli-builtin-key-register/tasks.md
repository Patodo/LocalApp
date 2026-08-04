## 1. 共享 key 文件基础设施

- [x] 1.1 在仓库根 `.gitignore` 添加 `packages/shared/.registration-key`
- [x] 1.2 编写 key 生成脚本 `scripts/generate-registration-key.{sh,mjs}`：生成 32 字节随机 hex，写入 `packages/shared/.registration-key`（若已存在则跳过）
- [x] 1.3 在根 `package.json` 添加 `setup` 脚本调用生成逻辑，并在 `postinstall` 钩子中触发（仅本地开发，CI 显式调用）
- [x] 1.4 运行 `pnpm setup` 验证文件生成成功，内容为一行 hex 字符串
- [x] 1.5 commit: `chore(infra): 添加共享 registration-key 文件与生成脚本`

## 2. Server 配置改造

- [x] 2.1 编写测试：`loadConfig` SHALL NOT 包含 `allowRegister` 和 `registrationKey` 字段（RED）
- [x] 2.2 修改 `packages/server/src/lib/config.ts`：从 `ServerConfig` 接口删除 `allowRegister` 和 `registrationKey` 字段及其默认值
- [x] 2.3 修改 `readTomlConfig`：移除 `auth.allow_register` 和 `auth.registration_key` 的解析
- [x] 2.4 修改 `loadConfig`：移除 `ALLOW_REGISTER` 和 `REGISTRATION_KEY` 环境变量读取
- [x] 2.5 编写测试：`loadConfig` SHALL 从共享文件读取 registrationKey（RED）
- [x] 2.6 新增 `readSharedRegistrationKey()` 函数：按优先级查找 `/app/.registration-key` → `packages/shared/.registration-key`，读取并 trim
- [x] 2.7 在 `loadConfig` 中调用该函数填充 `registrationKey` 字段（字段从 config 接口移除，但内部仍需持有用于 cli-register 校验）
- [x] 2.8 运行全量配置测试，验证绿（GREEN）
- [x] 2.9 commit: `refactor(server): 移除 allow_register/registration_key 配置项，改从共享文件读取 key`

## 3. Server 端点改造

- [x] 3.1 编写测试：`POST /api/auth/register` SHALL 返回 404（RED）
- [x] 3.2 编写测试：`POST /api/auth/cli-register` 携带正确内置 key + 合法 username → 创建用户并返回 apiKey（RED）
- [x] 3.3 编写测试：`POST /api/auth/cli-register` 无 key / 错误 key / pattern 不匹配 / 用户已存在 → 对应 403/409（RED）
- [x] 3.4 删除 `packages/server/src/routes/auth.ts` 中 `POST /api/auth/register` 端点
- [x] 3.5 新增 `POST /api/auth/cli-register` 端点：校验 `X-Registration-Key` 与内置 key、校验 username 匹配 `autoRegisterPattern`、固定密码 `localapp`、`must_change_password=1`、生成 API Key 返回
- [x] 3.6 运行新增测试，验证绿（GREEN）；REFACTOR 提取重复逻辑
- [x] 3.7 commit: `feat(server): 移除公开注册端点，新增 cli-register 内置 key 注册端点`

## 4. CLI build.rs + key 注入

- [x] 4.1 创建 `packages/cli/build.rs`：读取 `packages/shared/.registration-key`，输出 `cargo:rustc-env=REGISTRATION_KEY=<value>` 和 `cargo:rerun-if-changed`
- [x] 4.2 在 `packages/cli/src/commands/login.rs`（或新模块）定义 `const REGISTRATION_KEY: &str = env!("REGISTRATION_KEY");`
- [x] 4.3 验证：删除共享文件后 `cargo build` 失败并提示运行 `pnpm setup`；恢复后编译成功
- [x] 4.4 commit: `feat(cli): 添加 build.rs 编译时注入 registration key`

## 5. CLI login 改造

- [x] 5.1 编写测试（或手动验证清单）：`localapp login` 无参数时 SHALL 用内置 key + OS 用户名调用 `/api/auth/cli-register`，成功则自动保存
- [x] 5.2 修改 `packages/cli/src/main.rs`：移除 `Login` 命令的 `--registration-key` 参数
- [x] 5.3 修改 `packages/cli/src/commands/login.rs`：`try_auto_register` 使用 `REGISTRATION_KEY` 常量替代参数传入；端点改为 `/api/auth/cli-register`；body 不再传 password
- [x] 5.4 修改 `run` 函数：移除 `cli_registration_key` 参数，自动注册分支无条件触发（当无现有 api_key 时）
- [x] 5.5 `cargo build` 编译通过；手动测试 `localapp login` 全流程（自动注册成功 / 409 回退 / 403 回退）
- [x] 5.6 commit: `feat(cli): login 零参数自动注册，移除 --registration-key`

## 6. 前端清理

- [x] 6.1 删除 `packages/web/app/(auth)/register/page.tsx` 整个文件
- [x] 6.2 移除 `packages/web/app/(auth)/login/page.tsx` 中指向 `/register` 的链接
- [x] 6.3 移除 `packages/web/components/shell/navbar.tsx` 中指向 `/register` 的链接
- [x] 6.4 移除 `packages/web/app/(dashboard)/page.tsx` 中指向 `/register` 的链接
- [x] 6.5 移除 `packages/server/src/routes/serve.ts` 中 `app.get("/register", ...)` 路由
- [x] 6.6 运行 `pnpm --filter web build` 验证无残留引用
- [x] 6.7 commit: `feat(web): 移除浏览器注册页面与所有导航链接`

## 7. 测试迁移

- [x] 7.1 新增 `packages/server/tests/helpers/createUser.ts`：封装 `POST /api/auth/cli-register`（带内置 key）创建用户并返回 apiKey
- [x] 7.2 编写 helper 单元测试：能成功创建用户并返回有效 apiKey
- [x] 7.3 批量替换所有集成测试中 `POST /api/auth/register` 调用为 `createTestUser()` helper（30+ 文件）
- [x] 7.4 重写 `packages/server/tests/integration/register-control.test.ts` 为 `cli-register.test.ts`，覆盖 spec 中所有 scenario
- [x] 7.5 运行全量集成测试 `pnpm --filter server test`，全部通过
- [x] 7.6 commit: `test: 迁移注册测试到 cli-register 端点，新增 createTestUser helper`

## 8. Docker 打包

- [x] 8.1 检查现有 Dockerfile（若存在），确认 build context 与 COPY 策略
- [x] 8.2 在 Dockerfile 中添加 `COPY packages/shared/.registration-key /app/.registration-key`
- [x] 8.3 验证 Docker 构建后 server 能从 `/app/.registration-key` 读取 key，`cli-register` 端点正常工作
- [x] 8.4 commit: `chore(docker): 打包时 COPY registration-key 到镜像固定路径`

## 9. 端到端验证

- [x] 9.1 启动 server（`pnpm dev`），配置本地 `AUTO_REGISTER_PATTERN` 适配 OS 用户名
- [x] 9.2 删除本地 `~/.localapp/work/config.json`，执行 `localapp login`，验证零参数自动注册成功
      - HTTP 层验证：`POST /api/auth/cli-register` + 内置 key + 合法 username → 200 + apiKey
      - CLI 层验证：`strings localapp.exe | grep <key>` 确认 REGISTRATION_KEY 已编译进 binary
      - 交互式 TTY 流程（`localapp login` 从真实终端执行）需用户手动验证
- [x] 9.3 验证 `localapp whoami` 或其他需鉴权命令正常工作
      - HTTP 层验证：返回的 apiKey 通过 `GET /api/me` + `X-API-Key` 鉴权成功
- [x] 9.4 验证已注册用户再次 `localapp login` 时回退到手动输入 api_key
      - HTTP 层验证：重复 cli-register 同一 username → 409 Username already exists（CLI 端会回退到 Password 对话框）
- [x] 9.5 验证浏览器访问 `/register` 返回 404 ✓
- [x] 9.6 验证 `POST /api/auth/register` 返回 404 ✓
- [x] 9.7 commit（若有修复）: `fix(e2e): 端到端验证修复`（无修复需要）
