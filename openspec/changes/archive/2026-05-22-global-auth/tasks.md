## 1. 基础设施：依赖与类型

- [x] 1.1 安装 bcryptjs、jsonwebtoken 依赖到 packages/server
- [x] 1.2 在 packages/shared/src/models.ts 中新增 User、AccessLevel、PageAccess、RouteAccess、AccessPolicy 类型定义；扩展 Page 类型增加可选 pageAccess 字段；扩展 DataSchema 类型增加可选 routeAccess 字段
- [x] 1.3 在 packages/shared/src/api.ts 中新增 RegisterRequest、LoginRequest、AuthResponse、MeResponse 接口定义
- [x] 1.4 运行 pnpm build 确认 shared 包类型导出正确
- [x] 1.5 提交：`feat(shared): 添加用户认证与访问控制类型定义`

## 2. 用户存储层（meta-sqlite 扩展）

- [x] 2.1 在 meta-sqlite.ts 中编写 users 表 DDL（id, name, password, provider, created_at），在 initMetaDb 时自动创建
- [x] 2.2 编写测试：启动时 users 表自动创建；已存在时不报错
- [x] 2.3 实现 createUser(id, name, passwordHash) 函数，返回创建的用户（不含密码）
- [x] 2.4 编写测试：创建用户成功；重复 id 返回冲突错误
- [x] 2.5 实现 findUserById(id) 函数，返回用户信息（不含密码）
- [x] 2.6 实现 findUserByName(name) 函数，用于登录时查找用户
- [x] 2.7 编写测试：按 id 和 name 查询用户
- [x] 2.8 提交：`feat(server): 添加 users 表和用户存储操作`

## 3. 认证路由（注册 / 登录 / 登出）

- [x] 3.1 创建 routes/auth.ts，实现 POST /api/auth/register：校验 username 格式（^[a-zA-Z0-9_-]{2,32}$）和密码长度（>=6），bcrypt 哈希密码，调用 createUser
- [x] 3.2 编写测试：注册成功返回用户信息；用户名已存在返回 409；格式不合法返回 400；密码过短返回 400
- [x] 3.3 实现 POST /api/auth/login：查找用户、bcrypt 验证密码、签发 JWT（exp=7d）、设置 HttpOnly cookie
- [x] 3.4 编写测试：登录成功设置 cookie 并返回用户信息；用户不存在返回 401；密码错误返回 401
- [x] 3.5 实现 POST /api/auth/logout：清除 token cookie
- [x] 3.6 编写测试：登出成功清除 cookie
- [x] 3.7 在 index.ts 中注册 auth 路由（无需鉴权）
- [x] 3.8 提交：`feat(server): 实现用户注册、登录、登出接口`

## 4. Session 中间件（身份提取）

- [x] 4.1 创建 plugins/session.ts，实现 sessionPlugin：从 cookie 提取 JWT，验证签名和过期，设置 req.visitorId（验证失败或无 cookie 时设为 null）
- [x] 4.2 编写测试：有效 cookie 设置 visitorId；过期 cookie 的 visitorId 为 null；无 cookie 的 visitorId 为 null
- [x] 4.3 在 index.ts 中注册 sessionPlugin，位置在 serve 路由之前、所有管理路由之前
- [x] 4.4 实现 GET /api/me：支持 cookie 和 API Key 两种认证，返回当前用户或 null
- [x] 4.5 编写测试：cookie 认证返回用户；API Key 认证返回用户；无认证返回 null
- [x] 4.6 提交：`feat(server): 实现 session 中间件和 /api/me 接口`

## 5. 访问控制引擎

- [x] 5.1 创建 lib/access-control.ts，实现 checkAccess(level, visitorId, ownerId, acl?) 函数：按 public/authenticated/owner/acl 规则返回 boolean
- [x] 5.2 编写测试：覆盖四种 level 的所有场景（含所有者始终通过的边界情况）
- [x] 5.3 实现 checkPageAccess(pageAccess, visitorId, ownerId) 封装函数（处理 pageAccess 未配置时默认 public）
- [x] 5.4 编写测试：未配置 pageAccess 时默认通过
- [x] 5.5 实现 checkRouteAccess(routeAccess, method, visitorId, ownerId) 封装函数（根据 HTTP method 选取对应 level，处理未配置时默认 public）
- [x] 5.6 编写测试：GET→read、POST→create、PUT→update、DELETE→delete 映射正确；未配置 routeAccess 时默认通过
- [x] 5.7 提交：`feat(server): 实现双层访问控制检查引擎`

## 6. Serve 路由集成访问控制

- [x] 6.1 修改 routes/serve.ts 的 iframe wrapper 路由：在返回 HTML 前执行 checkPageAccess，不通过时返回 401/403
- [x] 6.2 编写测试：页面 authenticated 未登录返回 401；页面 owner 非所有者返回 403；public 正常返回
- [x] 6.3 修改静态文件服务路由：在提供文件前执行 checkPageAccess
- [x] 6.4 编写测试：受保护页面的静态文件被正确拦截
- [x] 6.5 修改 handleCrudRequest：在执行 CRUD 操作前执行 checkPageAccess，然后执行 checkRouteAccess
- [x] 6.6 编写测试：路由级 authenticated 拦截匿名 POST；路由级 ACL 允许列表内用户；双层检查页面级优先
- [x] 6.7 提交：`feat(server): 在 serve 路由中集成双层访问控制`

## 7. 平台壳（iframe 外层进化）

- [x] 7.1 修改 routes/serve.ts 的 iframe wrapper：将空壳 HTML 替换为带导航栏的平台壳（显示应用名、登录/注册按钮或用户头像）
- [x] 7.2 平台壳从 req.visitorId 判断登录状态，已登录显示用户名和登出按钮，未登录显示登录/注册链接
- [x] 7.3 平台壳内嵌登录/注册表单的简单页面（/login、/register 路由）
- [x] 7.4 编写测试：已登录访问页面显示用户名；未登录访问显示登录按钮
- [x] 7.5 提交：`feat(server): 实现 platform shell，显示登录状态和导航`

## 8. Schema/Page 管理接口扩展

- [x] 8.1 修改 routes/schemas.ts 的 POST /api/schemas：接受可选 routeAccess 字段，存储到 meta.json
- [x] 8.2 编写测试：创建 schema 时指定 routeAccess 成功存储；不指定 routeAccess 时 meta.json 中无该字段
- [x] 8.3 修改 routes/pages.ts：支持更新 pageAccess 字段
- [x] 8.4 编写测试：更新页面 pageAccess 成功
- [x] 8.5 提交：`feat(server): 管理接口支持访问策略配置`

## 9. E2E 测试：认证流程

- [x] 9.1 注册流程：正常注册成功返回用户信息；重复用户名返回 409；用户名格式不合法返回 400；密码过短返回 400
- [x] 9.2 登录流程：正确凭据登录成功并设置 cookie；用户名不存在返回 401；密码错误返回 401
- [x] 9.3 登出流程：登出后 cookie 被清除，后续 /api/me 返回 null
- [x] 9.4 /api/me 接口：cookie 认证返回用户信息；API Key 认证返回对应用户；无凭证返回 null
- [x] 9.5 Cookie 属性验证：登录成功后 Set-Cookie 包含 HttpOnly、SameSite=Lax、Path=/
- [x] 9.6 完整链路：注册→登录→访问页面→CRUD 操作→登出→再次访问验证身份消失
- [x] 9.7 提交：`test(e2e): 添加用户认证流程 e2e 测试`

## 10. E2E 测试：页面级访问控制

- [x] 10.1 页面 public：未登录用户可访问静态文件和 CRUD
- [x] 10.2 页面 authenticated：未登录访问返回 401；已登录用户可访问
- [x] 10.3 页面 owner：非所有者访问返回 403；所有者访问正常
- [x] 10.4 页面 acl：ACL 列表内用户可访问；列表外用户返回 403；所有者始终可访问
- [x] 10.5 未配置 pageAccess：行为等同于 public，任何人均可访问
- [x] 10.6 页面级拦截优先：页面级拒绝时 CRUD 操作不执行（验证返回的是页面级 401/403 而非路由级）
- [x] 10.7 动态切换策略：页面从 public 改为 authenticated 后，未登录访问立即被拒
- [x] 10.8 提交：`test(e2e): 添加页面级访问控制 e2e 测试`

## 11. E2E 测试：路由级访问控制

- [x] 11.1 per-method 拦截：read=public + create=authenticated 时，匿名 GET 通过、匿名 POST 返回 401
- [x] 11.2 update=owner：非所有者 PUT 返回 403；所有者 PUT 成功
- [x] 11.3 delete=owner：非所有者 DELETE 返回 403；所有者 DELETE 成功
- [x] 11.4 routeAccess.acl：ACL 列表内用户可操作；列表外用户返回 403；所有者始终可操作
- [x] 11.5 未配置 routeAccess：四种操作均为 public，任何人均可 CRUD
- [x] 11.6 双层组合：页面 public + 路由 create=authenticated 时，匿名读通过、匿名写被拒
- [x] 11.7 多资源差异化：同一页面下资源 A 配 public、资源 B 配 owner，分别验证访问结果
- [x] 11.8 创建 schema 时指定 routeAccess 并验证生效
- [x] 11.9 提交：`test(e2e): 添加路由级访问控制 e2e 测试`

## 12. E2E 测试：平台壳与多用户交互

- [x] 12.1 平台壳登录状态：已登录访问页面时 HTML 中显示用户名；未登录时显示登录按钮
- [x] 12.2 多用户交叉访问：alice 创建页面和 schema，bob 登录后访问 alice 的公开页面并 CRUD
- [x] 12.3 所有者权限边界：所有者在任何访问策略下都能完全操作（包括 acl 场景）
- [x] 12.4 登录页面 /login 和注册页面 /register 可正常渲染和提交
- [x] 12.5 提交：`test(e2e): 添加平台壳与多用户交互 e2e 测试`
