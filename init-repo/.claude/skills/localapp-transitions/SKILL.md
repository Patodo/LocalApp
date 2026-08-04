---
name: localapp-transitions
description: >
  LocalApp 状态流转（state transitions）建模指南——把业务状态的合法迁移
  作为前端元数据声明在 schema `business.transitions[]`，前端用 `useTransitions()`
  本地计算可用动作；实际执行由应用在 `backend/resources/<table>/mutations.json`
  中声明的 named mutation（如 `$<table>.<action>`）承担。当用户要在 LocalApp
  项目中实现请假/报销/工单等带"提交""审批""驳回""完成"等状态变化的应用时触发；
  也适用于用户说"提交后不能改"、"审批通过/拒绝"、"任务流转"、"状态机"、
  "按钮控制状态"等场景。
---

# LocalApp 状态流转

业务状态变化通过 **`business.transitions[]` 元数据 + named mutation 执行** 完成，
**不要用 `useUpdate` 改 status 字段**。

核心思路（两段式）：

1. **元数据声明**：把"哪些状态可以转出/转入、谁能转、目标状态"写进 schema 的
   `business.transitions[]`，前端 SDK 据此本地计算可用按钮。
2. **执行入口**：在 `backend/resources/<table>/mutations.json` 中为每个状态流转
   声明对应的 named mutation（如 `$leaves.submit`、`$leaves.approve`），SQL 中
   显式校验当前状态（WHERE 子句）并写入目标状态。

> 平台不再提供 `/api/{resource}/{id}/transitions` 服务端执行端点（restrict-app-api-to-named-sql
> 变更移除）。transitions 降级为前端 UI 提示用的元数据，状态机的正确性由 SQL WHERE
> 子句保证。

## schema business.transitions 格式

```json
{
  "fields": {
    "title": { "type": "string", "constraints": { "required": true } },
    "created_by": { "type": "string" },
    "status": {
      "type": "string",
      "constraints": { "defaultValue": "draft", "enum": ["draft", "submitted", "approved", "rejected"] }
    },
    "submitted_at": { "type": "timestamp" },
    "reviewed_by": { "type": "string" },
    "reviewed_at": { "type": "timestamp" }
  },
  "business": {
    "kind": "request",
    "ownerField": "created_by",
    "statusField": "status",
    "initialStatus": "draft",
    "transitions": [
      { "name": "submit", "label": "提交", "from": ["draft"], "to": "submitted" },
      { "name": "approve", "label": "批准", "from": ["submitted"], "to": "approved" },
      { "name": "reject", "label": "驳回", "from": ["submitted"], "to": "rejected" }
    ]
  }
}
```

字段含义：

- `statusField`：状态字段名（必须存在于 migration 表结构中）
- `initialStatus`：新建记录的初始状态（不写时为 null）
- `transitions[]`：合法状态迁移定义（前端 UI 用）
  - `name`：transition 唯一标识（用于命名 `$<resource>.<name>` mutation）
  - `label`：显示给用户的按钮文字
  - `from`：当前状态必须命中此数组之一才允许执行（前端据此过滤可用按钮）
  - `to`：执行后写入 statusField 的值（仅作 UI 提示，实际写入由 SQL 负责）

> `access` / `set` 字段在原服务端执行模型下有意义，现已移除。访问控制改由
> named mutation 的 `access` 字段表达，字段写入（如 `reviewed_at = :now`、
> `reviewed_by = :currentUser.id`）改由 SQL 语句直接表达。

## named mutation：状态流转的实际执行入口

为每个 transition 在 `backend/resources/<table>/mutations.json` 声明对应的
named mutation。SQL 中**必须**在 WHERE 子句校验当前状态：

```json
{
  "$schema": "https://localapp.dev/schemas/backend/mutations.schema.json",
  "mutations": {
    "$leaves.submit": {
      "kind": "mutation",
      "access": "owner",
      "params": { "id": { "type": "number", "required": true } },
      "sql": "UPDATE leaves SET status = 'submitted', submitted_at = :now WHERE id = :id AND status = 'draft' AND created_by = :currentUserId"
    },
    "$leaves.approve": {
      "kind": "mutation",
      "access": "authenticated",
      "params": { "id": { "type": "number", "required": true } },
      "sql": "UPDATE leaves SET status = 'approved', reviewed_by = :currentUserId, reviewed_at = :now WHERE id = :id AND status = 'submitted' AND reviewed_by = :currentUserId"
    },
    "$leaves.reject": {
      "kind": "mutation",
      "access": "authenticated",
      "params": { "id": { "type": "number", "required": true } },
      "sql": "UPDATE leaves SET status = 'rejected', reviewed_at = :now WHERE id = :id AND status = 'submitted' AND reviewed_by = :currentUserId"
    }
  }
}
```

要点：

- WHERE 子句包含 `status = '<from>'` 防止非法状态流转
- WHERE 子句包含权限校验（如 `created_by = :currentUserId`、`reviewed_by = :currentUserId`）实现访问控制
- `:currentUserId` / `:now` 等系统变量由 named SQL 执行器自动注入，前端无法伪造
- mutation 的 `access` 字段提供额外的声明级访问控制（如 `"owner"` 限定记录所有者）

## React SDK Hook

```tsx
import { useTransitions } from "@localapp/sdk-react";
import type { BusinessMetadata } from "@localapp/sdk-react";

// 从 /_schemas 端点或静态 import 拿到 schema 元数据
const leaveSchema: BusinessMetadata = {
  statusField: "status",
  transitions: [
    { name: "submit", label: "提交", from: ["draft"], to: "submitted" },
    { name: "approve", label: "批准", from: ["submitted"], to: "approved" },
    { name: "reject", label: "驳回", from: ["submitted"], to: "rejected" },
  ],
};

function LeaveRow({ leave }: { leave: Leave }) {
  // 本地计算可用 transitions，不发网络请求
  const { transitions, transition, loading, error } = useTransitions<Leave>(
    "leaves",
    leave,
    leaveSchema,
  );

  return (
    <div>
      <span>{leave.title} — 状态: {leave.status}</span>
      {error && <p className="text-red-500">{error.message}</p>}
      <div>
        {transitions.map((t) => (
          <Button
            key={t.name}
            disabled={loading}
            onClick={async () => {
              try {
                // 内部调用 mutate('$leaves.<name>', { id: leave.id, ...payload })
                await transition(t.name);
              } catch {
                // LocalAppError 已写入 hook 的 error 状态
              }
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

`useTransitions(resource, record, schema, options?)` 行为：

- `record` 必须含 `id` 字段，可为 `null`（适合列表占位行）
- 本地根据 `schema.statusField` 取 record 当前状态，过滤 `transitions.from` 命中项
- `transition(name, payload?)`：调用 `mutate('$<resource>.<name>', { id: record.id, ...payload })`
- `options.onSuccess(result)`：执行成功回调，传入 mutate 返回的 ExecResult
- 任何错误以 `LocalAppError` 形式写入 `error`

## 开发模式验证 transitions

运行 `localapp dev` 后，用 Dev Toolkit 验证状态机：

- Identity：切到记录所有者、审批人、无权用户和未登录用户，确认按钮显示与 named mutation 的 access 字段一致。
- Time：切到固定 ISO 时间，执行包含 `:now` 的 mutation，确认 `submitted_at`、`reviewed_at` 等字段写入固定时间。
- Data：用 snapshot 保存 draft/submitted 等关键状态，restore 后重复验证不同路径。
- Diagnostics：检查最近请求和 `manifest.business.transitions` 是否与按钮展示一致。

切换身份、时间或 restore snapshot 后 DevShell 会派发 `localapp:dev-context-changed`，列表和详情 hooks 会自动刷新。

## 为什么不要用 `useUpdate` 改状态

- ❌ `useUpdate` 走的是 `$<resource>.update` named mutation，作者可能没在 SQL 里加 status 守卫，前端可以随意把 "approved" 改回 "draft"
- ❌ 没有 `:now` / `:currentUser.id` 等系统变量自动注入，时间戳和审批人字段需要前端自己填，容易伪造或不一致
- ❌ 权限分散在 React 组件里，没有集中的"审批人才能改"语义

> 在新的 named SQL 唯一通道模型下，`useUpdate` 和 transition mutation 都是 named
> mutation，技术上没有强制的差异。但**约定**上：状态字段（statusField）的变更
> 必须走 `$<resource>.<action>` 风格的 transition mutation（含状态守卫），其它
> 字段的编辑才用 `$<resource>.update`。模板和 Agent 指引据此约束。

## 常见模式

### 申请-审批（request）

```
draft ──submit──▶ submitted ──approve──▶ approved
                            └──reject───▶ rejected
```

- `$leave.submit`：`WHERE id=:id AND status='draft' AND created_by=:currentUserId`
- `$leave.approve`：`WHERE id=:id AND status='submitted' AND reviewed_by=:currentUserId`，SET 写入 `reviewed_by` / `reviewed_at`
- `$leave.reject`：同 approve，但 SET 写入 `status='rejected'`

### 任务流转（assignment）

```
todo ──start──▶ in_progress ──complete──▶ done
                              └──cancel──▶ cancelled
```

- `$task.start`：`WHERE id=:id AND status='todo' AND assignee_id=:currentUserId`
- `$task.complete`：`WHERE id=:id AND status='in_progress' AND assignee_id=:currentUserId`，SET `completed_at`
- `$task.cancel`：`WHERE id=:id AND status IN ('todo', 'in_progress')`（多源迁移）

### 草稿发布（catalog）

```
draft ──publish──▶ published
draft ──archive──▶ archived
published ──unpublish──▶ draft
```

- 适合产品/文章/配置类目录的发布开关
- 用 `access: "authenticated"` 默认策略，由 named mutation 的 access 字段控制谁能调用

## 反模式

- ❌ 用 `useUpdate("leaves", { status: "approved" })` 改状态——绕过状态机守卫
- ❌ 在前端拼好时间戳或用户 ID 提交——应该用 SQL 里的 `:now` / `:currentUserId` 系统变量
- ❌ 在 React 中根据当前状态硬编码按钮（`status === "draft" && <Button>提交</Button>`）——和 schema 中的 `from` 不一致时会失同步，应改用 `useTransitions` 本地计算
- ❌ mutation SQL 忘记在 WHERE 中加状态守卫——非法状态流转将不被拦截

## 与其他 skill 的关系

- 业务模型选择和 `recordAccess` 配套：见 `localapp-business.md`
- CRUD Hook 不适合做状态变化：见 `localapp-data.md`
- `usePermissions()` / `<Can>` 用于 UI 展示判断：见 `localapp-auth.md`
