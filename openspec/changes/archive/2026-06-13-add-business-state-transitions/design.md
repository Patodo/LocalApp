## Context

LocalApp 的业务应用正在从“能 CRUD 数据”走向“能表达业务过程”。P0 的业务建模变更负责定义业务字段、状态字段、当前用户默认值和记录级权限；本变更在此基础上提供轻量状态流转，让提交、审批、拒绝、关闭等动作不再只是普通 `update`。

当前系统已有 schema 存储、CRUD API、访问控制、React SDK 和模板指引。状态流转应复用这些基础设施，不引入新的工作流引擎或后端服务。

## Goals / Non-Goals

**Goals:**

- 允许 schema 声明状态字段、初始状态和可执行 transitions。
- 提供后端 transition 查询和执行端点，统一校验当前状态、目标状态和权限。
- 提供 React SDK Hook，帮助应用展示可用动作并执行 transition。
- 指导 Agent 在申请、审批、工单等应用中优先使用 transition API。
- 保持无 transitions 的旧 schema 和普通 CRUD 行为不变。

**Non-Goals:**

- 不实现完整 BPMN、工作流画布、多节点编排或并行审批。
- 不实现通知、定时任务、操作日志或活动时间线。
- 不实现跨 schema 的事务流程。
- 不禁止普通 `useUpdate`，但模板和指引会要求业务状态变化优先使用 transition API。

## Decisions

### 1. transitions 作为 schema 业务元数据的一部分

在 schema 的业务元数据中加入 `transitions` 数组：

```json
{
  "business": {
    "statusField": "status",
    "initialStatus": "draft",
    "transitions": [
      {
        "name": "submit",
        "label": "提交",
        "from": ["draft"],
        "to": "submitted",
        "access": { "mode": "ownerField", "field": "created_by" },
        "set": { "submitted_at": "now" }
      },
      {
        "name": "approve",
        "label": "批准",
        "from": ["submitted"],
        "to": "approved",
        "access": { "mode": "authenticated" },
        "set": { "reviewed_at": "now", "reviewed_by": "currentUser.id" }
      }
    ]
  }
}
```

原因：状态流转依赖状态字段和记录权限，把它放在 schema 元数据里能让服务端、SDK、Agent 使用同一份契约。

备选方案是独立 `workflow` 配置。它更清晰，但 P1 阶段会增加配置同步和迁移复杂度。

### 2. transition 是受控 update

执行 transition 本质上是一次受控更新：服务端读取记录，验证当前状态是否位于 `from`，验证访问策略，写入 `to` 状态，并应用允许的 `set` 字段或请求 payload。

原因：这能最大化复用现有 SQLite、CRUD、字段校验、记录级权限和错误处理。

备选方案是创建独立状态机运行时。它能力更强，但过早，也容易偏离“小应用快速开发”的目标。

### 3. 新增记录级 transition 端点

端点形态：

```text
GET  /serve/{userId}/{name}/api/{resource}/{id}/transitions
POST /serve/{userId}/{name}/api/{resource}/{id}/transitions/{transitionName}
```

查询端点返回当前记录可用 transition 列表；执行端点执行指定 transition。执行失败时返回明确的 400/401/403/404。

原因：把 transition 作为资源记录下的动作，比把它塞进普通 PUT 更清晰，也方便 Agent 发现和使用。

### 4. SDK 提供 useTransitions

`@localapp/sdk-react` 新增 `useTransitions(resource, id, options?)`，返回 `{ transitions, transition, loading, error, refresh }`。其中 `transition(name, payload?)` 执行状态流转并返回更新后的记录。

原因：应用常见需求是“显示当前可用动作按钮，并在点击后刷新记录/列表”，Hook 能覆盖主要 UI 场景。

备选方案是只在 core client 提供方法。这样更底层，但应用开发者和 Agent 仍要自己拼 loading/error/refresh 模式。

### 5. 先不做 activity log，但为后续留下事件点

transition 执行路径集中在服务端 helper，未来可以在成功后追加 activity log。当前变更不写日志表，只保证执行点清晰。

原因：activity log 很有价值，但会引入存储、查询、展示和隐私边界，应作为独立 P1.x 变更。

## Risks / Trade-offs

- transition 规则过复杂会变成工作流引擎 -> 首批只支持单记录、单状态字段、显式 from/to 和简单访问策略。
- 普通 update 仍可直接改状态 -> 文档和 Agent 指引要求业务状态变化使用 transition；是否硬性禁止普通 update 修改状态可作为实施阶段的安全选项评估。
- transition 权限和 P0 记录级权限可能重复 -> 复用相同访问策略格式，避免两套 DSL。
- SDK 可用动作与后端判断可能漂移 -> 可用动作列表由服务端返回，SDK 不自行推导最终可执行性。
- P0 尚未实施时 P1 缺少部分类型基础 -> 实施顺序应先完成 P0，再应用 P1；本变更制品可先并行准备。

## Migration Plan

1. transitions 字段为可选字段，旧 schema 无需迁移。
2. 未声明 transitions 的 schema 不暴露可用动作，执行 transition 返回 404 或 400。
3. SDK 新增导出，不修改现有 Hook。
4. 模板示例和 Agent 指引默认使用 transition API，但旧应用仍可用普通 CRUD 更新。
5. 回滚时移除 transition 端点和 Hook；旧数据记录仍只是普通状态字段。

## Open Questions

- 是否在首版禁止普通 CRUD update 直接修改 `statusField`。
- transition payload 是否允许写入任意字段，还是只允许 schema 声明的 `inputFields`。
- transition `access` 是否需要支持 group/ACL，还是首版只支持 ownerField/authenticated/page owner。
