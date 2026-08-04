## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the group-profile-ui capability in LocalApp.

## Requirements

### Requirement: profile 页面群组 tab

profile 页面 SHALL 新增"分组"选项卡，与"个人资料"、"我的应用"、"API Key"并列。

#### Scenario: 显示分组 tab
- **WHEN** 用户访问 `/profile` 页面
- **THEN** tab 栏可见"分组"选项

#### Scenario: 切换到群组管理
- **WHEN** 用户点击"分组"tab
- **THEN** 显示用户创建的群组和用户所在的群组列表

### Requirement: 查看私有群组列表

群组 tab SHALL 展示两类群组：用户创建的群组（可管理）和用户作为成员加入的群组（只读）。列表项显示群组名、描述、成员数量、是否为创建者。

#### Scenario: 显示群组列表
- **WHEN** 用户进入"分组"tab
- **THEN** 列表展示用户创建的群组（标记"管理"）和加入的群组（标记"成员"）

### Requirement: 创建私有群组

用户 SHALL 能在群组 tab 中创建新的私有群组，填写名称和描述。

#### Scenario: 创建群组
- **WHEN** 用户点击"创建群组"，填写名称和描述后提交
- **THEN** 私有群组创建成功（system=0），用户自动成为创建者和成员

#### Scenario: 名称重复
- **WHEN** 用户创建群组时使用了已存在的群组名称
- **THEN** 显示错误提示"群组名称已存在"

### Requirement: 管理私有群组成员

创建者 SHALL 能在群组详情中查看成员列表，并添加或移除成员。

#### Scenario: 查看成员
- **WHEN** 创建者点击自己管理的群组
- **THEN** 展示成员列表，每行显示用户名、显示名，以及移除按钮

#### Scenario: 添加成员
- **WHEN** 创建者在群组详情中搜索/选择用户并添加
- **THEN** 该用户被加入群组，成员列表刷新

#### Scenario: 移除成员
- **WHEN** 创建者点击某成员的移除按钮
- **THEN** 该用户从群组中移除（创建者不能移除自己）

#### Scenario: 成员只能查看
- **WHEN** 非创建者的成员点击群组
- **THEN** 只能查看成员列表，没有添加/移除按钮

### Requirement: 修改私有群组属性

创建者 SHALL 能修改私有群组的名称和描述。

#### Scenario: 修改群组信息
- **WHEN** 创建者编辑群组名称或描述并保存
- **THEN** 群组信息更新成功

### Requirement: 解散私有群组

创建者 SHALL 能解散自己的私有群组，解散后所有成员关系清除。

#### Scenario: 解散群组
- **WHEN** 创建者点击"解散群组"并确认
- **THEN** 群组被删除，群组从列表中消失，ACL 中对该群组的引用失效

#### Scenario: 成员不能解散
- **WHEN** 非创建者尝试解散群组
- **THEN** 不显示"解散群组"按钮
