## Why

当前 ACL 只能逐个列出用户 ID（`acl: ["userA", "userB"]`），无法按组织结构（部门、团队、项目组）进行授权。在实际使用中，公司部署后需要按部门控制应用访问权限，每次人员变动都需要手动更新 ACL，管理成本高且容易遗漏。群组能力是场景分析中 8/20 个典型内部应用场景的前置依赖。

## What Changes

- 新增**群组系统**：分系统群组和用户私有群组，独立管理
- 系统群组：启动时自动创建 `everyone` 全员群组，管理员在 `/admin` 面板管理
- 私有群组：任何登录用户可创建，创建者拥有管理权限，在 `/profile` 页面管理
- 新增群组 CRUD API（创建、查询、修改、删除群组）
- 新增群组成员管理 API（批量添加、移除成员）
- 扩展 ACL 语义：`acl` 数组支持 `group:<name>` 前缀引用群组，与用户 ID 混用
- 改造 `checkAccess` 逻辑：解析群组引用时查询成员表
- 新增 SDK Hook：`useGroups()`、`useGroupMembers(groupId)`
- `/admin` 面板新增"分组"页面，管理系统群组的成员和属性
- `/profile` 页面新增"分组"tab，管理私有群组的完整生命周期
- CLI 新增 `groups` 子命令（create、list、info、delete、members add/remove）

## Capabilities

### New Capabilities

- `group-crud`: 群组的创建、查询、修改、删除 API 及数据模型
- `group-membership`: 群组成员的添加、移除、查询
- `group-acl`: ACL 扩展支持群组引用，改造 checkAccess 逻辑
- `group-sdk`: SDK 层暴露 useGroups / useGroupMembers Hook
- `group-admin-ui`: /admin 面板的系统群组管理页面
- `group-profile-ui`: /profile 页面的私有群组管理 tab
- `group-cli`: CLI 群组管理子命令

### Modified Capabilities

- `access-control`: ACL 的 `acl` 字段语义扩展，支持 `group:` 前缀
- `admin-panel`: 侧边栏新增"分组"导航项
- `user-profile-ui`: tab 栏新增"分组"选项卡

## Impact

- **数据库**：meta.sqlite 新增 `groups` 和 `group_members` 两张表
- **服务端**：新增 `src/routes/groups.ts` 路由文件；改造 `src/lib/access-control.ts`；`src/lib/meta-sqlite.ts` 新增群组数据操作
- **admin 前端**：`packages/admin/` 新增 Groups 页面和路由，侧边栏加导航项
- **profile 前端**：`packages/profile/` 新增 Groups tab 页面
- **SDK**：`init-repo/src/lib/localapp/` 新增 Hook 及类型
- **CLI**：`packages/cli/` 新增 groups 子命令模块
- **测试**：集成测试覆盖群组 API，UI 无自动化测试（手动验证）
- **向后兼容**：完全兼容，现有 ACL 格式不受影响
