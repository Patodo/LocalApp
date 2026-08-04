## 1. 契约基线与失败测试

- [x] 1.1 RED：为 mini-server 增加 `/api/{resource}/count` 失败测试，验证当前 `GET /api/work_items/count` 不应被解析为 `id=count`
- [x] 1.2 RED：为 mini-server 增加 `/api/me` 标准响应失败测试，期望 `{ success: true, data: User | null }`
- [x] 1.3 RED：为 mini-server 增加 `/api/users`、`/api/groups` 不落入 CRUD fallback 的失败测试
- [x] 1.4 RED：为 mini-server 增加 `/api/content/upload` 和 `/api/content/{key}` 失败测试
- [x] 1.5 RED：为 mini-server 增加 `/api/db/exec` 查询、写入、权限失败测试
- [x] 1.6 RED：增加契约矩阵测试，列出 SDK 公开方法对应的 dev/prod 端点并校验 mini-server 至少覆盖 P0/P1 路径
- [x] 1.7 RED：增加共享契约层缺失测试，证明生产 serve 和 mini-server 当前各自手写路由，`/count` 等保留路径无法由同一处理器覆盖
- [x] 1.8 验证：运行 `pnpm -C init-repo test -- mini-server.test.ts client.test.ts`，确认新增测试按预期失败

## 2. 共享应用 API 契约层

- [x] 2.1 GREEN：在 `packages/server-core` 中新增传输无关的应用 API 契约处理层，定义标准请求、标准响应、路由匹配和保留路径优先级
- [x] 2.2 GREEN：将 CRUD list/get/create/update/delete/count 的路由解析和响应包装迁入共享层
- [x] 2.3 GREEN：将 transition 查询/执行的路由解析和响应包装迁入共享层，继续复用现有 transition 核心逻辑
- [x] 2.4 GREEN：将 raw SQL 和 time 的应用 API 契约迁入共享层，运行时差异通过 provider 注入
- [x] 2.5 GREEN：为生产 Fastify serve 添加 adapter，将 `/serve/{user}/{page}/api/*` 标准化后交给共享层
- [x] 2.6 GREEN：为 mini-server Node http 添加 adapter，将 `/api/*` 标准化后交给共享层
- [x] 2.7 REFACTOR：删除或收缩生产 serve 与 mini-server 中重复的 CRUD/count/transition 路由分支，保留运行时专属逻辑
- [x] 2.8 验证：运行共享层单元测试和生产/mini-server adapter 聚焦测试
- [x] 2.9 提交：提交共享契约层，提交信息使用 `refactor(server): 统一应用 API 契约层`

## 3. P0：补齐 mini-server 基础契约

- [x] 3.1 GREEN：调整 mini-server `/api/*` 路由优先级，先处理保留路径，再进入共享应用 API 层
- [x] 3.2 GREEN：从共享应用 API 层支持 `GET /api/{resource}/count`
- [x] 3.3 GREEN：count 查询复用列表查询的过滤剥离逻辑，忽略 `offset`、`limit`、`sort`、`order`
- [x] 3.4 GREEN：count 查询应用 `recordAccess.read` 和 dev context visitor，保证 count 与 list pagination.total 一致
- [x] 3.5 GREEN：将 mini-server `/api/me` 响应改为 `{ success: true, data }`，未登录返回 `{ success: true, data: null }`
- [x] 3.6 GREEN：同步修正 DevShell 内部读取 `/api/me` 的解析逻辑，兼容标准响应
- [x] 3.7 REFACTOR：整理 mini-server 平台路径、内容路径、raw SQL 路径和 CRUD 路径的分派函数，降低继续漂移风险
- [x] 3.8 验证：运行 mini-server 聚焦测试，确认 P0 测试通过
- [x] 3.9 提交：提交 P0 修复，提交信息使用 `fix(dev): 补齐 mini-server 基础 API 契约`

## 4. P1：补齐平台、内容上传和 raw SQL

- [x] 4.1 GREEN：实现 dev `/api/users` mock/代理逻辑，至少包含当前 dev context user、`dev-user`、`alice`、`bob`
- [x] 4.2 GREEN：实现 dev `/api/groups` 和 `/api/groups/{id}` mock/代理逻辑，返回与 SDK `GroupBasic` / group members 期待一致的数据
- [x] 4.3 GREEN：完善 `/api/platform/*` 代理失败处理，失败时返回稳定 mock 数据或明确 JSON 错误，不进入 CRUD fallback
- [x] 4.4 GREEN：实现 `/api/content/upload`，保存文件到 `.localapp/dev-uploads/`，返回 `{ key, url }`
- [x] 4.5 GREEN：实现 `/api/content/{key}` 文件读取，限制路径在 `.localapp/dev-uploads/` 内并返回合适 content-type
- [x] 4.6 GREEN：保留旧 `/api/upload` 作为兼容别名，返回与 SDK `UploadResult` 同构的数据
- [x] 4.7 GREEN：实现 `/api/db/exec`，复用共享应用 API 层和 `.localapp/dev.db` 持久化
- [x] 4.8 GREEN：为 `/api/db/exec` 应用 `manifest.db.sqlAccess`，覆盖未登录、非 owner、允许访问场景
- [x] 4.9 REFACTOR：将 mini-server 内容存储、平台 mock、raw SQL 访问控制拆成小函数，避免 `handleRequest` 膨胀
- [x] 4.10 验证：运行 `pnpm -C init-repo test -- mini-server.test.ts`，确认 P1 全部通过
- [x] 4.11 提交：提交 P1 修复，提交信息使用 `feat(dev): 补齐平台内容和 SQL 本地 API`

## 5. P2：SDK 兼容保护与 Hook 行为

- [x] 5.1 RED：为 `packages/sdk-core` 或 init-repo SDK 测试增加 `client.count()` 旧运行时 404 降级测试
- [x] 5.2 RED：增加 `client.count()` 遇到 401/403 不降级的测试
- [x] 5.3 GREEN：实现 `client.count()` 在 404 或明确未支持错误时降级到 `list(limit: 1)` 读取 `pagination.total`
- [x] 5.4 GREEN：确保 `client.count()` 对 401/403/400/500 继续抛出 `LocalAppError`
- [x] 5.5 GREEN：确认 `useCount()` 继承 SDK 行为，dev context 切换后可刷新
- [x] 5.6 REFACTOR：统一 SDK 请求错误解析，保证非 JSON 或旧响应形态的错误信息可诊断
- [x] 5.7 验证：运行 SDK 相关测试，确认 `client.test.ts`、`use-count` 相关测试通过
- [x] 5.8 提交：提交 P2 SDK 兼容，提交信息使用 `fix(sdk): 为 count 增加旧运行时兼容`

## 6. 文档和 skill 收敛

- [x] 6.1 更新 `init-repo/.claude/skills/localapp-data/SKILL.md`，明确推荐 `client.count()` / `useCount()`，不推荐应用层 `list(limit: 1)` 作为常规写法
- [x] 6.2 更新 `init-repo/.claude/skills/localapp/SKILL.md`，补充 dev/prod API 契约一致性说明
- [x] 6.3 更新与上传相关 skill，确认应用内容上传推荐 `/api/content/upload` 和 `useUpload()`
- [x] 6.4 增加文档一致性测试，防止 skill 中继续推荐临时兼容写法
- [x] 6.5 验证：运行 `pnpm -C init-repo test -- dev-shell-template.test.ts client.test.ts`
- [x] 6.6 提交：提交文档收敛，提交信息使用 `docs(sdk): 收敛应用 API 推荐写法`

## 7. 真实应用验证

- [x] 7.1 构建 debug CLI：在 `packages/cli` 运行 `cargo build`
- [x] 7.2 在 `E:\Code\localapp\LocalApp-work\sample-app` 使用 debug CLI 执行 `localapp sync`
- [x] 7.3 在 `sample-app` 运行 `pnpm install` 和 `pnpm build`
- [x] 7.4 将 `sample-app` 的 seed 判断从 `list(limit: 1)` 恢复为 `client.count()`，验证本地 dev 不再失败
- [x] 7.5 在 `sample-app` 运行 debug `localapp dev`，验证 `/api/work_items/count` 返回正确数量
- [x] 7.6 浏览器验证 `http://localhost:5173/?todoUnified=1`：Dev Toolkit 可见、日期可切换、应用今日日期生效、创建资源可用
- [x] 7.7 验证 `useUsers()`、`useGroups()`、`useUpload()`、`useExec()` 的最小 dev 行为，至少通过脚本或浏览器 fetch 覆盖端点
- [x] 7.8 提交：提交真实应用验证所需的框架侧补充，提交信息使用 `test(dev): 验证 SDK API 本地契约`

## 8. 总体验证和收尾

- [x] 8.1 运行 `pnpm -C init-repo test`
- [x] 8.2 运行 `pnpm -C init-repo build`
- [x] 8.3 运行相关 server 测试，覆盖生产 serve 的 `/count`、content、raw SQL 端点未退化
- [x] 8.4 运行 `cargo build` 确认 CLI 可构建
- [x] 8.5 检查 `git diff`，确认没有修改无关目标项目文件或临时文件
- [x] 8.6 更新任务完成状态，记录无法自动化验证的手工验证结果
- [x] 8.7 最终提交，提交信息使用 `chore(dev): 完成 SDK API 契约对齐`
