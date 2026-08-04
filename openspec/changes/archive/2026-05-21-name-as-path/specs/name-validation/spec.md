## Purpose

应用名称合法性校验规则。定义 name 的格式约束，CLI 和 Server 共用相同的验证逻辑，确保用户输入的 name 在整个系统中一致有效。

## ADDED Requirements

### Requirement: name 格式约束

应用名称 SHALL 符合以下规则：
- 只允许小写字母（a-z）、数字（0-9）、连字符（-）
- 必须以字母开头
- 长度 3-63 字符
- 禁止连续连字符（--）
- 禁止首尾连字符

#### Scenario: 合法名称
- **WHEN** 输入名称 `my-cool-app`
- **THEN** 验证通过

#### Scenario: 最短合法名称
- **WHEN** 输入名称 `abc`
- **THEN** 验证通过（3 字符，字母开头）

#### Scenario: 最长合法名称
- **WHEN** 输入名称为 63 个小写字母
- **THEN** 验证通过

#### Scenario: 包含大写字母
- **WHEN** 输入名称 `My-Cool-App`
- **THEN** 验证失败

#### Scenario: 包含下划线
- **WHEN** 输入名称 `my_cool_app`
- **THEN** 验证失败

#### Scenario: 包含空格
- **WHEN** 输入名称 `my cool app`
- **THEN** 验证失败

#### Scenario: 数字开头
- **WHEN** 输入名称 `123app`
- **THEN** 验证失败

#### Scenario: 连续连字符
- **WHEN** 输入名称 `my--app`
- **THEN** 验证失败

#### Scenario: 连字符开头
- **WHEN** 输入名称 `-my-app`
- **THEN** 验证失败

#### Scenario: 连字符结尾
- **WHEN** 输入名称 `my-app-`
- **THEN** 验证失败

#### Scenario: 名称太短
- **WHEN** 输入名称 `ab`
- **THEN** 验证失败（不足 3 字符）

#### Scenario: 名称太长
- **WHEN** 输入名称为 64 个小写字母
- **THEN** 验证失败（超过 63 字符）

#### Scenario: 空名称
- **WHEN** 输入名称为空字符串
- **THEN** 验证失败

### Requirement: name 保留词

应用名称 SHALL NOT 使用系统保留路径，包括 `api`、`serve`、`health`、`cli`、`keys`、`upload`、`pages`、`schemas`。

#### Scenario: 使用保留词 api
- **WHEN** 输入名称 `api`
- **THEN** 验证失败

#### Scenario: 使用保留词 serve
- **WHEN** 输入名称 `serve`
- **THEN** 验证失败

#### Scenario: 使用非保留词
- **WHEN** 输入名称 `my-api-tool`
- **THEN** 验证通过（包含保留词子串但非完全匹配）
