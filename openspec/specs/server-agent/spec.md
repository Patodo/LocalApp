## Purpose

统一 LocalApp Server 提供应用内 Agent、模型供应商配置、工具执行、历史及后台工作；SDK、Platform Shell 和 DevShell 使用相同的能力。

## Requirements

### Requirement: 每个用户配置自己的模型供应商

Server SHALL 保存当前用户的多个模型配置和默认选择。请求 SHALL 使用发起用户选择的模型配置，不自动使用 Server 全局 LLM 凭据。持久化凭据 SHALL 加密保存，读取设置 SHALL 不返回密钥。

#### Scenario: 用户的请求使用自己的模型和密钥
- **WHEN** 两个用户配置不同的模型和密钥并使用相同会话 ID 发起请求
- **THEN** 每个请求使用对应用户的配置，用户之间不共享会话内容

#### Scenario: 用户未配置模型
- **WHEN** 已登录用户没有可用的模型配置
- **THEN** 请求失败并提示前往模型设置，不使用 Server 全局模型配置

### Requirement: 应用声明和用户选择共同决定能力

Server SHALL 检查当前用户对应用的访问权限，并只提供应用 manifest 声明及该用户允许的额外能力。文件、终端、MCP、Skills、子 Agent、后台任务、网页读取、工作流及定时任务 SHALL 由统一 Server 执行，不启动另一套后端。

#### Scenario: 应用声明和用户允许的能力不同
- **WHEN** 应用声明 files 和 subagents，用户允许 files 和 terminal
- **THEN** 该应用 Agent 只能获得 files，不获得 subagents 或 terminal

#### Scenario: 用户没有应用访问权限
- **WHEN** 用户请求不可访问应用的 Agent
- **THEN** Server 拒绝请求

#### Scenario: 文件和终端隔离
- **WHEN** Agent 尝试读取另一个应用的 Agent 工作目录
- **THEN** 文件 API 及终端执行均拒绝读取

### Requirement: 应用注册工具及系统提示词

应用 SHALL 能通过现有 SDK 注册系统提示词及页面工具。Server SHALL 使用 dsh 的真实 Agent 循环，将工具调用传给应用，将返回结果交给用户选择的模型继续执行。子 Agent SHALL 能使用同一应用注册的页面工具。

#### Scenario: 页面工具调用
- **WHEN** 模型调用应用已注册工具
- **THEN** 浏览器执行工具，Server 只接受所属用户的结果并继续对话

#### Scenario: 子 Agent 使用页面工具
- **WHEN** 主 Agent 将任务交给子 Agent，子 Agent 调用应用工具
- **THEN** 应用执行工具，子 Agent 使用对应用户的模型继续工作

### Requirement: 前端支持持久会话与后台事件

共享聊天界面 SHALL 提供模型选择、新对话、历史恢复、停止、操作确认和问题回答。独立事件流 SHALL 在前台请求结束后继续传递后台页面工具及用户交互。页面工具需要应用保持打开。会话历史 SHALL 在 Server 重启后可恢复。

#### Scenario: 后台页面工具
- **WHEN** 前台请求结束后，同一 Agent 的后台工作调用页面工具
- **THEN** 独立事件连接将调用传到应用并接受结果

#### Scenario: 重启后恢复历史
- **WHEN** Server 重新打开已经保存的会话
- **THEN** 用户能读取历史并继续对话

### Requirement: MCP 使用用户配置

HTTP 及 stdio MCP SHALL 使用用户的 MCP 配置，并只在该应用允许 MCP 时连接；stdio 执行 SHALL 使用应用工作目录及操作系统隔离。

#### Scenario: HTTP MCP 工具调用
- **WHEN** Agent 调用用户配置的 MCP 工具
- **THEN** Server 连接指定 MCP 服务并使用该用户的凭据返回工具结果
