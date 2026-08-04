## 1. 服务端 LLM 代理端点

- [x] 1.1 [RED] 编写 `POST /api/llm/chat` 端点的失败测试：未登录返回 401、缺少 messages 返回 400、messages 格式错误返回 400、未配置 LLM_API_KEY 返回 503
- [x] 1.2 [RED] 编写 LLM 代理端点成功流程的失败测试：已登录用户发起对话返回 SSE 流、流式响应包含 LLM chunk 和 [DONE]、默认模型为 gpt-4o-mini
- [x] 1.3 [RED] 编写 LLM 服务不可用时返回 502 的失败测试
- [x] 1.4 [GREEN] 在 `src/lib/config.ts` 中新增 LLM 配置字段（llmApiKey、llmModel、llmBaseUrl），从环境变量读取
- [x] 1.5 [GREEN] 新建 `src/routes/llm.ts`，实现 `POST /api/llm/chat` 端点，包含请求验证、用户鉴权、LLM 转发、SSE 流式响应
- [x] 1.6 [GREEN] 在 `src/index.ts` 中注册 llm 路由
- [x] 1.7 [REFACTOR] 提取 SSE 流式响应的工具函数，统一错误处理格式
- [x] 1.8 commit 服务端 LLM 代理端点

## 2. Agent 运行时核心

- [x] 2.1 在 init-repo 中安装 `pi-ai` 和 `pi-agent-core` npm 依赖，配置 vitest 测试环境
- [x] 2.2 [RED] 编写 useAgent 初始化的失败测试：基本初始化返回 { send, messages, isRunning, error }、带自定义工具注册系统+自定义工具、带系统提示包含额外描述
- [x] 2.3 [RED] 编写 Agent 消息循环的失败测试：纯文本回复、触发工具调用、多轮工具调用、运行中拒绝发送
- [x] 2.4 [RED] 编写 schema 上下文注入的失败测试：有 schema 时注入描述、无 schema 时正常工作
- [x] 2.5 [RED] 编写 LLM 调用适配的失败测试：正常调用通过代理端点、调用失败设置 error 状态
- [x] 2.6 [GREEN] 创建 `src/lib/localapp/agent/llm-adapter.ts`，适配 pi-ai 的 callLLM 指向 `POST /api/llm/chat`，实现 SSE 流解析
- [x] 2.7 [GREEN] 创建 `src/lib/localapp/agent/types.ts`，定义 AgentMessage、AgentTool、UseAgentOptions、UseAgentReturn 类型
- [x] 2.8 [GREEN] 创建 `src/lib/localapp/agent/tools.ts`，实现系统级只读工具（getCurrentUser、queryData、listSchemas）
- [x] 2.9 [GREEN] 创建 `src/lib/localapp/agent/context.ts`，实现 schema 上下文自动获取和格式化
- [x] 2.10 [GREEN] 创建 `src/lib/localapp/agent/use-agent.ts`，实现 useAgent Hook，封装 pi-agent-core 的 Agent 循环
- [x] 2.11 [GREEN] 在 `src/lib/localapp/index.ts` 中导出 useAgent 和相关类型
- [x] 2.12 [REFACTOR] 提取公共逻辑，统一工具注册和消息格式处理
- [x] 2.13 commit Agent 运行时核心

## 3. AgentChat UI 组件

- [x] 3.1 [RED] 编写 AgentChat 基本交互的失败测试：空对话界面渲染、发送消息调用 agent.send、运行中禁用输入
- [x] 3.2 [RED] 编写消息展示的失败测试：用户消息右对齐气泡、Agent 消息左对齐气泡、流式消息光标闪烁效果
- [x] 3.3 [RED] 编写工具调用和错误展示的失败测试：工具执行中加载指示器、工具完成折叠展示、错误横幅、清除错误继续对话
- [x] 3.4 [GREEN] 创建 `src/lib/localapp/agent/agent-chat.tsx`，实现 AgentChat 组件：消息列表、输入框、发送按钮
- [x] 3.5 [GREEN] 实现用户消息和 Agent 消息的气泡样式区分
- [x] 3.6 [GREEN] 实现流式消息实时展示，带光标闪烁效果
- [x] 3.7 [GREEN] 实现工具调用状态展示（加载指示器 + 折叠结果）
- [x] 3.8 [GREEN] 实现错误展示横幅
- [x] 3.9 [GREEN] 实现 Agent 运行中禁用输入状态
- [x] 3.10 [GREEN] 在 `src/lib/localapp/index.ts` 中导出 AgentChat
- [x] 3.11 [REFACTOR] 提取消息气泡和工具状态子组件，统一样式
- [x] 3.12 commit AgentChat UI 组件

## 4. 文档与模板更新

- [x] 4.1 更新 `init-repo/CLAUDE.md`，添加 useAgent 和 AgentChat 使用文档
- [x] 4.2 在 CLAUDE.md 中添加 Agent SDK 常用模式示例（表单填写助手、数据查询助手）
- [x] 4.3 commit 文档更新

## 5. 端到端验证

| Spec Scenario | E2E Test | Status |
|---|---|---|
| llm-proxy > Scenario: 已登录用户发起对话 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 未登录用户发起对话 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 请求体缺少 messages | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: messages 格式错误 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: LLM 服务不可用 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 未配置 LLM_API_KEY | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 使用默认模型 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 流式响应正常完成 | LLM 代理端点集成测试 | ✓ |
| llm-proxy > Scenario: 流式响应中断 | LLM 代理端点集成测试 | ✓ |
| agent-runtime > Scenario: 基本初始化 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 带自定义工具初始化 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 带系统提示初始化 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 纯文本回复 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 触发工具调用 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 多轮工具调用 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: Agent 正在运行时发送消息 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 页面有 schema | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 页面无 schema | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: 正常调用 | Hook 单元测试 | ✓ |
| agent-runtime > Scenario: LLM 调用失败 | Hook 单元测试 | ✓ |
| agent-tools > Scenario: Agent 调用 getCurrentUser | 工具单元测试 | ✓ |
| agent-tools > Scenario: Agent 调用 queryData | 工具单元测试 | ✓ |
| agent-tools > Scenario: Agent 调用 listSchemas | 工具单元测试 | ✓ |
| agent-tools > Scenario: 未登录用户 Agent 调用 getCurrentUser | 工具单元测试 | ✓ |
| agent-tools > Scenario: 注册自定义写操作工具 | 工具单元测试 | ✓ |
| agent-tools > Scenario: 自定义工具执行成功 | 工具单元测试 | ✓ |
| agent-tools > Scenario: 自定义工具执行失败 | 工具单元测试 | ✓ |
| agent-tools > Scenario: 工具定义格式正确 | 工具单元测试 | ✓ |
| agent-tools > Scenario: 工具定义缺少 description | 工具单元测试 | ✓ |
| agent-ui > Scenario: 渲染空对话界面 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 发送消息 | 组件单元测试 | ✓ |
| agent-ui > Scenario: Agent 运行中禁用输入 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 用户消息展示 | 组件单元测试 | ✓ |
| agent-ui > Scenario: Agent 文本消息展示 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 流式消息实时展示 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 工具正在执行 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 工具执行完成 | 组件单元测试 | ✓ |
| agent-ui > Scenario: Agent 错误展示 | 组件单元测试 | ✓ |
| agent-ui > Scenario: 清除错误后继续对话 | 组件单元测试 | ✓ |

- [x] 5.1 [GREEN] 为 llm-proxy > Scenario: 已登录用户发起对话 编写集成测试
- [x] 5.2 [GREEN] 为 llm-proxy > Scenario: 未登录用户发起对话 编写集成测试
- [x] 5.3 [GREEN] 为 llm-proxy > Scenario: 请求体缺少 messages 编写集成测试
- [x] 5.4 [GREEN] 为 llm-proxy > Scenario: messages 格式错误 编写集成测试
- [x] 5.5 [GREEN] 为 llm-proxy > Scenario: LLM 服务不可用 编写集成测试
- [x] 5.6 [GREEN] 为 llm-proxy > Scenario: 未配置 LLM_API_KEY 编写集成测试
- [x] 5.7 [GREEN] 为 llm-proxy > Scenario: 使用默认模型 编写集成测试
- [x] 5.8 [GREEN] 为 llm-proxy > Scenario: 流式响应正常完成 编写集成测试
- [x] 5.9 [GREEN] 为 llm-proxy > Scenario: 流式响应中断 编写集成测试
- [x] 5.10 [GREEN] 为 agent-runtime > Scenario: 基本初始化 编写单元测试
- [x] 5.11 [GREEN] 为 agent-runtime > Scenario: 带自定义工具初始化 编写单元测试
- [x] 5.12 [GREEN] 为 agent-runtime > Scenario: 带系统提示初始化 编写单元测试
- [x] 5.13 [GREEN] 为 agent-runtime > Scenario: 纯文本回复 编写单元测试
- [x] 5.14 [GREEN] 为 agent-runtime > Scenario: 触发工具调用 编写单元测试
- [x] 5.15 [GREEN] 为 agent-runtime > Scenario: 多轮工具调用 编写单元测试
- [x] 5.16 [GREEN] 为 agent-runtime > Scenario: Agent 正在运行时发送消息 编写单元测试
- [x] 5.17 [GREEN] 为 agent-runtime > Scenario: 页面有 schema 编写单元测试
- [x] 5.18 [GREEN] 为 agent-runtime > Scenario: 页面无 schema 编写单元测试
- [x] 5.19 [GREEN] 为 agent-runtime > Scenario: 正常调用 编写单元测试
- [x] 5.20 [GREEN] 为 agent-runtime > Scenario: LLM 调用失败 编写单元测试
- [x] 5.21 [GREEN] 为 agent-tools > Scenario: Agent 调用 getCurrentUser 编写单元测试
- [x] 5.22 [GREEN] 为 agent-tools > Scenario: Agent 调用 queryData 编写单元测试
- [x] 5.23 [GREEN] 为 agent-tools > Scenario: Agent 调用 listSchemas 编写单元测试
- [x] 5.24 [GREEN] 为 agent-tools > Scenario: 未登录用户 Agent 调用 getCurrentUser 编写单元测试
- [x] 5.25 [GREEN] 为 agent-tools > Scenario: 注册自定义写操作工具 编写单元测试
- [x] 5.26 [GREEN] 为 agent-tools > Scenario: 自定义工具执行成功 编写单元测试
- [x] 5.27 [GREEN] 为 agent-tools > Scenario: 自定义工具执行失败 编写单元测试
- [x] 5.28 [GREEN] 为 agent-tools > Scenario: 工具定义格式正确 编写单元测试
- [x] 5.29 [GREEN] 为 agent-tools > Scenario: 工具定义缺少 description 编写单元测试
- [x] 5.30 [GREEN] 为 agent-ui > Scenario: 渲染空对话界面 编写单元测试
- [x] 5.31 [GREEN] 为 agent-ui > Scenario: 发送消息 编写单元测试
- [x] 5.32 [GREEN] 为 agent-ui > Scenario: Agent 运行中禁用输入 编写单元测试
- [x] 5.33 [GREEN] 为 agent-ui > Scenario: 用户消息展示 编写单元测试
- [x] 5.34 [GREEN] 为 agent-ui > Scenario: Agent 文本消息展示 编写单元测试
- [x] 5.35 [GREEN] 为 agent-ui > Scenario: 流式消息实时展示 编写单元测试
- [x] 5.36 [GREEN] 为 agent-ui > Scenario: 工具正在执行 编写单元测试
- [x] 5.37 [GREEN] 为 agent-ui > Scenario: 工具执行完成 编写单元测试
- [x] 5.38 [GREEN] 为 agent-ui > Scenario: Agent 错误展示 编写单元测试
- [x] 5.39 [GREEN] 为 agent-ui > Scenario: 清除错误后继续对话 编写单元测试
- [x] 5.40 运行全量测试确认无回归
