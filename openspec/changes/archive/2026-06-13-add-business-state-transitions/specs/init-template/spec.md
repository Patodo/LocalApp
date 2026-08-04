## ADDED Requirements

### Requirement: 模板包含状态流转开发指引

`init-repo/` SHALL 包含状态流转开发指引，说明申请、审批、工单等应用应优先使用 transition API 表达业务动作。

#### Scenario: CLAUDE.md 包含状态流转入口
- **WHEN** 阅读 `init-repo/CLAUDE.md`
- **THEN** 文档 SHALL 包含状态流转相关 skill 的入口说明

#### Scenario: 状态流转 skill 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/`
- **THEN** 目录 SHALL 包含状态流转相关 skill 文件

### Requirement: 模板示例展示 transition UI 模式

模板默认示例或业务建模示例 SHALL 展示如何根据可用 transitions 渲染操作按钮，并在执行后刷新记录或列表。

#### Scenario: 示例使用 useTransitions
- **WHEN** 查看模板示例代码
- **THEN** 示例 SHALL 展示 `useTransitions` 或等价 API 的使用方式

#### Scenario: 示例不直接用普通 update 改业务状态
- **WHEN** 示例需要提交、审批、拒绝或关闭记录
- **THEN** 示例 SHALL 使用 transition API，而不是直接通过普通 update 修改状态字段
