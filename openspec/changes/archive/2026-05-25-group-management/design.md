## Context

当前 ACL 系统使用 `acl: string[]` 存储用户 ID 列表，`checkAccess()` 通过 `acl.includes(visitorId)` 判断权限。系统无群组概念，所有权限控制都是逐用户粒度。

群组需要在现有 meta.sqlite 中新增两张表，并改造 ACL 检查逻辑。群组路由与 profile 路由类似，运行在 authPlugin 作用域之外，需要手动处理认证。

系统有两套独立前端：
- **admin 面板**（`packages/admin/`）：React + react-router-dom，URL 路由，侧边栏导航。管理员管理系统级资源
- **profile 页面**（`packages/profile/`）：React，state-based tab 切换。普通用户管理个人资源

两套前端都通过 Vite 构建输出到 `packages/server/static/`。

CLI（`packages/cli/`）使用 Rust + clap derive 宏定义子命令，通过 reqwest HTTP 客户端调用 server API。

## Goals / Non-Goals

**Goals:**

- 提供群组 CRUD 能力（创建、查询、修改、删除）
- 提供群组成员管理（批量添加、移除成员）
- 系统启动时自动创建 `everyone` 全员群组
- ACL 支持引用群组（`group:<name>` 前缀），与用户 ID 混用
- SDK 暴露 `useGroups()` 和 `useGroupMembers(groupId)` Hook
- `/admin` 面板新增群组管理页面，管理系统群组
- `/profile` 页面新增群组管理 tab，管理私有群组
- CLI 新增 `groups` 子命令支持群组管理

**Non-Goals:**

- 不做群组嵌套（群组内不能包含群组）
- 不做群组角色（如群主、管理员等区分角色，只有创建者有管理权限）
- 不做群组审批流（创建群组不需要审批）
- 不做管理员干预私有群组（管理员只管系统群组，不管用户的私有群组）

## Decisions

### 1. 群组分治：系统群组 vs 私有群组

**选择**：两类群组共用 `groups` 表，通过 `system` 字段区分。管理入口完全分离：
- 系统群组（system=1）：`/admin` 面板管理，只有管理员能操作
- 私有群组（system=0）：`/profile` 页面管理，创建者操作

**理由**：管理员的双重身份（管理员管系统群组、用户管私有群组）通过不同入口天然隔离，不需要在 API 层做复杂的权限判断。

**备选方案**：API 层统一管理，前端根据 role 过滤 → 后端逻辑复杂，且管理员的私有群组跟系统群组混在一起不好区分。

### 2. 群组 name 全局唯一

**选择**：`name` 设 UNIQUE 约束，ACL 中用 `group:<name>` 引用。

**理由**：name 全局唯一保证 ACL 引用无歧义。私有群组的 name 也全局唯一（如不同用户的"项目组"需要起不同名字）。

### 3. ACL 中用 `group:` 前缀区分群组和用户

**选择**：`acl` 数组中 `group:` 开头的字符串视为群组引用，否则视为用户 ID。

**理由**：复用现有 `acl: string[]` 类型，不需要改 PageAccess / RouteAccess 接口。最小侵入。

### 4. 群组路由独立文件

**选择**：新建 `src/routes/groups.ts`，手动处理 API Key 和 Cookie 双认证。

**理由**：群组路由需要同时支持两种认证方式，与 `/api/users` 路由模式一致。

### 5. checkAccess 改造：在线查询

**选择**：每次 ACL 检查遇到 `group:` 引用时直接查询 `group_members` 表。

**理由**：用户量 500-2000，群组数量有限，SQLite 内存查询足够快。

### 6. admin 面板群组页面

**选择**：在 `packages/admin/` 中新增 `Groups.tsx` 页面，路由 `/admin/groups`，侧边栏加"分组"导航。复用 admin 现有的 Layout 和 API client 模式。后端新增 `GET/POST/PUT/DELETE /api/admin/groups` 系列端点。

**理由**：系统群组的管理属于 admin 职责，放在 admin 面板最自然。

### 7. profile 页面群组 tab

**选择**：在 `packages/profile/` 中新增 `Groups.tsx` 页面，作为新 tab 加入 `TabLayout`。调用 `/api/groups` 系列 API。

**理由**：私有群组是用户个人资产，放在 profile 页面与"我的应用"、"API Key"并列。

### 8. CLI groups 子命令

**选择**：在 `packages/cli/` 中新增 `src/commands/groups.rs`，定义 `GroupsAction` 枚举（list、create、delete、members-add、members-remove），复用现有的 config/client 模式。

**理由**：与 pages、schemas 子命令模式一致，开发成本低。

## Risks / Trade-offs

- **[ACL 解析性能]** → 每次 checkAccess 可能查数据库。缓解：群组数量有限（预计 <50），单次查询走 SQLite 内存索引，微秒级。
- **[群组删除后 ACL 引用失效]** → 删除群组时 ACL 中的 `group:<name>` 变成无效引用。缓解：删除群组时返回警告，ACL 检查时忽略无效群组引用。
- **[name 全局唯一冲突]** → 不同用户创建的私有群组不能重名。缓解：返回 409 Conflict，用户需要加前缀区分。
- **[前端构建产物需同步]** → admin 和 profile 改动需要重新 build 才能生效。缓解：在 tasks 中明确 build 步骤。
