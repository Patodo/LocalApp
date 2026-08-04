## 1. Server 配置扩展

- [x] 1.1 在 `ServerConfig` 接口中添加 `allowRegister`、`adminDefaultPassword`、`registrationKey`、`autoRegisterPattern` 四个字段及默认值
- [x] 1.2 在 `readTomlConfig` 中解析 `auth.allow_register`、`auth.admin_default_password`、`auth.registration_key`、`auth.auto_register_pattern`
- [x] 1.3 在 `loadConfig` 中支持环境变量 `ALLOW_REGISTER`、`ADMIN_DEFAULT_PASSWORD`、`REGISTRATION_KEY`、`AUTO_REGISTER_PATTERN`，布尔值做字符串转换
- [x] 1.4 编写配置加载的单元测试：默认值、config.toml 覆盖、环境变量覆盖、布尔转换

## 2. Admin Bootstrap 改造

- [x] 2.1 修改 `initMetaDb` 中 admin 用户创建逻辑：使用 `provider='local'`、密码为 `bcrypt(adminDefaultPassword)`、`must_change_password=1`
- [x] 2.2 处理 admin 已存在的情况：已有密码不覆盖，无密码则设为默认密码 + must_change_password=1
- [x] 2.3 编写 bootstrap 测试：首次创建 admin、admin 已存在无密码、admin 已存在有密码、未配置 bootstrapApiKey

## 3. 注册路由改造

- [x] 3.1 在 `POST /api/auth/register` 中添加 `X-Registration-Key` 头检查逻辑
- [x] 3.2 无 key 时检查 `allowRegister`，为 false 返回 403
- [x] 3.3 有 key 时验证 `registrationKey` 配置匹配，不匹配返回 403
- [x] 3.4 验证 username 匹配 `autoRegisterPattern`，不匹配返回 403
- [x] 3.5 CLI 注册时使用固定密码 `localapp`、设置 `must_change_password=1`
- [x] 3.6 CLI 注册成功后生成 API Key 并在响应中返回
- [x] 3.7 编写注册路由测试：allow_register=false 拒绝、registration_key 有效/无效、pattern 匹配/不匹配、API Key 返回

## 4. Provider 检查清理

- [x] 4.1 `findUserByName` 去掉 `AND provider = 'local'` 过滤条件
- [x] 4.2 `admin.ts` 删除 `provider === "system"` 的重置密码限制
- [x] 4.3 `profile.ts` 删除 `provider !== "local"` 的改密限制
- [x] 4.4 编写回归测试：admin 可重置所有用户密码、用户可自行改密、findUserByName 可查到所有用户

## 5. CLI 登录流程改造

- [x] 5.1 `client.rs` 添加支持 `X-Registration-Key` 头的请求方法（或扩展现有 post_json）
- [x] 5.2 `login.rs` 添加获取 OS 用户名的函数（复用 `dev.rs` 中的 `get_os_username` 或提取为公共模块）
- [x] 5.3 `login.rs` 修改 `run` 函数：检测未配置时，用 OS 用户名尝试 `POST /register`（带 registration_key）
- [x] 5.4 处理注册响应：成功则保存 API key 到 config；409（已存在）则回退到手动输入 API key；403 则提示联系 admin
- [x] 5.5 编译验证 CLI 改动，手动测试 `localapp login` 流程

## 6. 端到端验证

- [x] 6.1 启动 server，验证 admin 可通过浏览器登录（admin / localadmin）并触发强制改密
- [x] 6.2 验证 `allow_register=false` 时浏览器注册返回 403
- [x] 6.3 验证 CLI 静默注册流程：新用户 `localapp login` → 自动注册 → 获得 API key → `localapp whoami` 正常
- [x] 6.4 验证已注册用户再次 login 时的回退行为
- [x] 6.5 提交所有变更
