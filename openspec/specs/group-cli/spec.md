## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the group-cli capability in LocalApp.

## Requirements

### Requirement: groups 子命令

CLI SHALL 支持 `localapp groups` 子命令，包含 list、create、delete 三个动作。

#### Scenario: 查看群组列表
- **WHEN** 执行 `localapp groups list`
- **THEN** 输出当前用户的群组列表，每行显示群组名、描述、成员数、是否为创建者

#### Scenario: 创建群组
- **WHEN** 执行 `localapp groups create --name <name> [--description <desc>]`
- **THEN** 创建私有群组，输出创建结果

#### Scenario: 删除群组
- **WHEN** 执行 `localapp groups delete --name <name>`
- **THEN** 解散群组，输出成功信息

### Requirement: groups members 子命令

CLI SHALL 支持 `localapp groups members` 子命令管理群组成员。

#### Scenario: 查看群组成员
- **WHEN** 执行 `localapp groups members --group <name>`
- **THEN** 输出该群组的成员列表

#### Scenario: 添加成员
- **WHEN** 执行 `localapp groups members --group <name> --add <userId1,userId2>`
- **THEN** 指定用户被加入群组

#### Scenario: 移除成员
- **WHEN** 执行 `localapp groups members --group <name> --remove <userId1>`
- **THEN** 指定用户从群组中移除
