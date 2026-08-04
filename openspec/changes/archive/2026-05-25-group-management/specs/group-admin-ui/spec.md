## ADDED Requirements

### Requirement: admin 面板群组导航

admin 面板侧边栏 SHALL 新增"分组"导航项，路由为 `/admin/groups`，与"概览"、"用户"等导航项并列。

#### Scenario: 侧边栏显示分组导航
- **WHEN** 管理员访问 `/admin`
- **THEN** 侧边栏可见"分组"导航项

#### Scenario: 点击进入群组管理页
- **WHEN** 管理员点击"分组"导航项
- **THEN** 路由跳转到 `/admin/groups`，显示系统群组列表

### Requirement: 管理员查看系统群组列表

admin 群组页面 SHALL 展示所有系统群组（system=1）的列表，包含群组名、描述、成员数量。

#### Scenario: 显示系统群组列表
- **WHEN** 管理员进入 `/admin/groups` 页面
- **THEN** 页面展示所有 system=1 的群组，每行显示名称、描述、成员数

### Requirement: 管理员查看群组成员

管理员 SHALL 能在群组详情中查看成员列表，并支持添加和移除成员。

#### Scenario: 查看群组成员
- **WHEN** 管理员点击某个系统群组
- **THEN** 展示该群组的成员列表，包含用户名和显示名

#### Scenario: 添加成员
- **WHEN** 管理员在群组详情中选择用户并点击添加
- **THEN** 该用户被加入群组，成员列表即时刷新

#### Scenario: 移除成员
- **WHEN** 管理员在群组详情中点击某成员的移除按钮
- **THEN** 该用户从群组中移除，成员列表即时刷新

### Requirement: 管理员修改系统群组属性

管理员 SHALL 能修改系统群组的名称和描述。

#### Scenario: 修改群组名称
- **WHEN** 管理员编辑群组名称并保存
- **THEN** 群组名称更新成功

### Requirement: 管理员创建系统群组

管理员 SHALL 能在 admin 面板创建新的系统群组。

#### Scenario: 创建系统群组
- **WHEN** 管理员点击"创建群组"按钮，填写名称和描述后提交
- **THEN** 新的系统群组创建成功（system=1），出现在列表中

### Requirement: admin 群组管理 API

后端 SHALL 提供管理员专用的群组管理端点，操作对象为系统群组（system=1）。

#### Scenario: GET /api/admin/groups 返回系统群组
- **WHEN** 管理员请求 `GET /api/admin/groups`
- **THEN** 返回所有 system=1 的群组列表

#### Scenario: POST /api/admin/groups 创建系统群组
- **WHEN** 管理员请求 `POST /api/admin/groups` 携带 `{ name, description }`
- **THEN** 创建 system=1 的群组

#### Scenario: 非 admin 访问被拒
- **WHEN** 非管理员请求 `/api/admin/groups`
- **THEN** 返回 403
