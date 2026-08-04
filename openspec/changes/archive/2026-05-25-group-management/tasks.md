## 1. 数据模型与数据层

- [x] 1.1 在 `meta-sqlite.ts` 中添加 `groups` 和 `group_members` 表的 CREATE TABLE 语句，系统初始化时自动建表
- [x] 1.2 实现 `createGroup(name, description, creatorId, system?)` 函数，创建群组并将创建者加入成员表
- [x] 1.3 实现 `findGroupById(id)` 和 `findGroupByName(name)` 查询函数
- [x] 1.4 实现 `listGroupsByUser(userId)` 函数，返回用户创建的 + 用户所在的群组，含 memberCount 和 isCreator 标记
- [x] 1.5 实现 `listSystemGroups()` 函数，返回所有 system=1 的群组，含 memberCount
- [x] 1.6 实现 `updateGroup(id, name?, description?)` 函数，含 name 唯一性检查
- [x] 1.7 实现 `deleteGroup(id)` 函数，同时删除 group_members 中的关联记录
- [x] 1.8 实现 `addGroupMembers(groupId, userIds[])` 批量添加成员函数，幂等
- [x] 1.9 实现 `removeGroupMembers(groupId, userIds[])` 批量移除成员函数，幂等，禁止移除创建者
- [x] 1.10 实现 `getGroupMembers(groupId)` 函数，返回成员列表（id、name、displayName）
- [x] 1.11 实现 `isUserInGroup(userId, groupName)` 函数，用于 ACL 检查
- [x] 1.12 在 `initMetaDb` 中实现系统启动时自动创建 `everyone` 群组，并将所有现有用户加入成员表
- [x] 1.13 在 `createUser` 中自动将新用户加入 `everyone` 群组
- [x] 1.14 编写数据层集成测试，覆盖群组 CRUD、成员管理、everyone 自动维护

## 2. 群组 API 路由（用户端）

- [x] 2.1 新建 `src/routes/groups.ts`，注册群组路由到 Fastify 实例
- [x] 2.2 实现 `POST /api/groups` 创建私有群组（需登录，支持 API Key 和 Cookie）
- [x] 2.3 实现 `GET /api/groups` 查询当前用户的群组列表（需登录）
- [x] 2.4 实现 `GET /api/groups/:id` 查询群组详情含成员（需登录 + 创建者或成员可访问）
- [x] 2.5 实现 `PUT /api/groups/:id` 修改群组（创建者可操作，系统群组不可改）
- [x] 2.6 实现 `DELETE /api/groups/:id` 解散私有群组（创建者可操作，系统群组不可删除）
- [x] 2.7 实现 `POST /api/groups/:id/members` 批量添加成员（创建者可操作）
- [x] 2.8 实现 `POST /api/groups/:id/members/remove` 批量移除成员（创建者可操作，不能移除自己）
- [x] 2.9 在 `src/index.ts` 中注册 groupsRoutes
- [x] 2.10 编写群组 API 集成测试，覆盖所有端点的正常流程和权限控制

## 3. 群组 API 路由（管理员端）

- [x] 3.1 在 `src/routes/admin.ts` 中新增 `GET /api/admin/groups` 端点，返回所有系统群组
- [x] 3.2 新增 `POST /api/admin/groups` 端点，创建系统群组（system=1）
- [x] 3.3 新增 `PUT /api/admin/groups/:id` 端点，修改系统群组属性
- [x] 3.4 新增 `POST /api/admin/groups/:id/members` 端点，添加系统群组成员
- [x] 3.5 新增 `POST /api/admin/groups/:id/members/remove` 端点，移除系统群组成员
- [x] 3.6 编写管理员群组 API 集成测试

## 4. ACL 改造

- [x] 4.1 修改 `checkAccess` 函数，遍历 acl 时对 `group:` 前缀条目调用 `isUserInGroup`，纯用户 ID 保持原逻辑
- [x] 4.2 处理无效群组引用：群组不存在时视为不匹配，不报错
- [x] 4.3 编写 ACL 群组解析的单元测试，覆盖纯用户 ID、纯群组、混合、无效引用等场景
- [x] 4.4 编写集成测试：页面级 ACL 引用群组时权限正确（通过/拒绝）
- [x] 4.5 编写集成测试：路由级 ACL 引用群组时权限正确（通过/拒绝）

## 5. SDK 层

- [x] 5.1 在 `init-repo/src/lib/localapp/types.ts` 中添加 `GroupBasic` 类型定义
- [x] 5.2 在 `client.ts` 的 `LocalAppClient` 接口中添加 `groups()` 和 `groupMembers(groupId)` 方法
- [x] 5.3 实现 `groups()` 方法，调用 `GET /api/groups`
- [x] 5.4 实现 `groupMembers(groupId)` 方法，调用 `GET /api/groups/:id` 并提取 members
- [x] 5.5 在 `react.ts` 中实现 `useGroups()` Hook
- [x] 5.6 在 `react.ts` 中实现 `useGroupMembers(groupId)` Hook
- [x] 5.7 在 `index.ts` 中导出 `useGroups`、`useGroupMembers`、`GroupBasic`
- [x] 5.8 更新 `init-repo/CLAUDE.md` 添加 useGroups 和 useGroupMembers 文档

## 6. Admin 面板群组 UI

- [x] 6.1 创建 `packages/admin/src/api/groups.ts`，封装管理员群组 API 调用
- [x] 6.2 创建 `packages/admin/src/pages/Groups.tsx`，实现系统群组列表展示
- [x] 6.3 实现群组详情面板：成员列表、添加/移除成员
- [x] 6.4 实现创建系统群组对话框
- [x] 6.5 实现修改群组属性功能
- [x] 6.6 在 `Layout.tsx` 侧边栏 navItems 中添加"分组"导航项
- [x] 6.7 在 `App.tsx` 中添加 `/admin/groups` 路由
- [x] 6.8 执行 `pnpm build:admin` 构建 admin 前端

## 7. Profile 页面群组 UI

- [x] 7.1 创建 `packages/profile/src/api/groups.ts`，封装用户群组 API 调用
- [x] 7.2 创建 `packages/profile/src/pages/Groups.tsx`，实现私有群组列表展示
- [x] 7.3 实现创建私有群组功能
- [x] 7.4 实现群组详情：成员列表、添加/移除成员（创建者）、只读成员列表（非创建者）
- [x] 7.5 实现修改群组属性功能
- [x] 7.6 实现解散群组功能（带确认对话框）
- [x] 7.7 在 `TabLayout.tsx` 的 tabs 数组中添加"分组"选项
- [x] 7.8 在 `App.tsx` 中添加 Groups tab 的条件渲染
- [x] 7.9 执行 `pnpm build:profile` 构建 profile 前端

## 8. CLI 群组命令

- [x] 8.1 创建 `packages/cli/src/commands/groups.rs`，实现 list 命令
- [x] 8.2 实现 create 命令（--name, --description）
- [x] 8.3 实现 delete 命令（--name）
- [x] 8.4 实现 members 子命令（--group, --add, --remove）
- [x] 8.5 在 `commands/mod.rs` 中注册 groups 模块
- [x] 8.6 在 `main.rs` 的 Commands 枚举中添加 Groups 变量和 GroupsAction 枚举
- [x] 8.7 在 `main.rs` 的 match 分发中添加 Groups 分支
- [x] 8.8 执行 `cargo build` 编译 CLI

## 9. 端到端验证与收尾

- [x] 9.1 重新编译 CLI（init-repo 模板变更需要 cargo build）
- [x] 9.2 运行全量集成测试确认无回归
- [x] 9.3 运行全量 E2E 测试确认无回归
- [x] 9.4 手动验证 admin 面板群组管理功能（已由 e2e-ui/admin.test.ts 群组测试覆盖）
- [x] 9.5 手动验证 profile 页面群组管理功能（已由 e2e-ui/profile.test.ts 群组测试覆盖）
- [x] 9.6 手动验证 CLI 群组命令（已由 e2e-cli/groups.test.ts 覆盖）
