## Purpose

Agent 工具定义框架。系统级只读工具自动暴露，用户自定义写操作工具由应用创建者通过 `useAgent({ tools })` 传入。

## ADDED Requirements

### Requirement: 系统级只读工具

SDK SHALL 自动注册以下只读工具，无需应用创建者手动配置：

- `getCurrentUser`：返回当前登录用户信息（id、name）
- `queryData`：查询指定资源的数据列表，接受 resource（必填）、filters（可选）、limit（可选）参数
- `listSchemas`：返回当前页面所有数据 schema 定义

#### Scenario: Agent 调用 getCurrentUser
- **WHEN** Agent 调用 getCurrentUser 工具
- **THEN** 返回 `{ id: "user1", name: "alice" }` 格式的当前用户信息

#### Scenario: Agent 调用 queryData
- **WHEN** Agent 调用 `queryData({ resource: "todos", filters: { done: false }, limit: 10 })`
- **THEN** 返回匹配条件的记录列表

#### Scenario: Agent 调用 listSchemas
- **WHEN** Agent 调用 listSchemas 工具
- **THEN** 返回当前页面的所有 schema 定义，包含字段名、类型、约束

#### Scenario: 未登录用户 Agent 调用 getCurrentUser
- **WHEN** 未登录用户页面中的 Agent 调用 getCurrentUser
- **THEN** 返回 null

### Requirement: 用户自定义工具

应用创建者 SHALL 能通过 `useAgent({ tools })` 注册自定义工具。自定义工具以对象形式传入，key 为工具名，value 为工具定义（含 description、parameters、execute）。

#### Scenario: 注册自定义写操作工具
- **WHEN** 应用创建者调用 `useAgent({ tools: { createTodo: { description: "创建待办事项", parameters: { title: { type: "string", required: true } }, execute: async (args) => { ... } } } })`
- **THEN** Agent 可调用 createTodo 工具，execute 函数在浏览器主线程执行

#### Scenario: 自定义工具执行成功
- **WHEN** Agent 调用自定义工具，execute 返回结果
- **THEN** 结果作为工具响应反馈给 LLM

#### Scenario: 自定义工具执行失败
- **WHEN** Agent 调用自定义工具，execute 抛出异常
- **THEN** 错误信息作为工具响应反馈给 LLM，Agent 循环不中断

### Requirement: 工具定义格式

自定义工具定义 SHALL 符合以下格式：

```typescript
{
  description: string;          // 工具描述，供 LLM 理解工具用途
  parameters: {                 // 参数定义，JSON Schema 格式
    [key: string]: {
      type: "string" | "number" | "boolean";
      required?: boolean;
      description?: string;
    }
  };
  execute: (args: Record<string, any>) => Promise<any>;  // 执行函数
}
```

#### Scenario: 工具定义格式正确
- **WHEN** 应用创建者传入符合格式的工具定义
- **THEN** 工具正常注册，LLM 可正确调用

#### Scenario: 工具定义缺少 description
- **WHEN** 应用创建者传入不含 description 的工具定义
- **THEN** 控制台输出警告，工具仍注册但 LLM 可能无法正确使用
