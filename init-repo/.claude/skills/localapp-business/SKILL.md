---
name: localapp-business
description: >
  LocalApp 业务应用建模指南——把 schema、当前用户、记录级权限、SDK Hook
  和 shadcn/ui 组合成可用业务应用。当用户要在 LocalApp 项目中创建请假、
  报销、工单、任务、客户跟进、目录、审批等带"归属""状态""审批人"等业务
  语义的应用时触发；也适用于用户说"用户只能看自己的数据"、"草稿可编辑
  提交后不可编辑"、"只有负责人能更新"、"分配任务给别人"等场景。
---

# LocalApp 业务应用建模

业务应用 = schema + 当前用户 + 记录级权限 + SDK 权限 UI。

核心思路：把"这条记录属于谁、谁能改、什么时候能改"写进 schema 的
`business` 元数据，让 CRUD API 在后端执行；前端只用 `usePermissions()`
和 `<Can>` 决定显示哪些按钮。

## 模型选择

按业务形态选择对应模型：

```
谁创建记录？        谁应该看到？                推荐模型
─────────────────────────────────────────────────────────
申请人自己          仅申请人 + 审批人           申请类（request）
任何登录用户        负责人 + 管理员             分配类（assignment）
系统/管理员         所有人可读                  目录类（catalog）
任何登录用户        仅创建者                    个人类（personal）
```

### 申请类（request）

适用：请假、报销、工单、报修、申请单等"用户提交、他人审批"的应用。

推荐字段：
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `title` / `reason` | string | required | 申请标题或理由 |
| `created_by` | string | `defaultFrom: "currentUser.id"` | 申请人，后端自动填充 |
| `status` | string | `enum: ["draft","submitted","approved","rejected"]` | 状态枚举 |
| `submitted_at` | timestamp | | 提交时间 |
| `reviewed_by` | string | `defaultFrom: "currentUser.id"` | 审批人（审批时由后端填） |

记录级权限：
- 申请人能读、能在 `draft` 状态下更新、能删除草稿
- 审批人能读、能在 `submitted` 状态下更新 status
- 列表对申请人本人可见（管理员/审批人通过其他方式查看）

### 审批类（approval）

申请类的进阶形态——记录有明确的"审批人"字段，需要按审批人分发。

字段：申请类字段 + `reviewed_by`（审批人）+ `reviewed_at`（审批时间）。

权限：
- 申请人 read/update（仅 draft）
- 审批人 read/update（仅 submitted 时改 status）

### 分配类（assignment）

适用：任务、客户跟进、处理单等"用户被指派负责"的应用。

推荐字段：
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `title` | string | required | 任务标题 |
| `assignee_id` | string | | 负责人 ID |
| `status` | string | `enum: ["todo","in_progress","done","cancelled"]` | 状态 |
| `due_at` | timestamp | | 截止时间 |
| `priority` | string | `enum: ["low","medium","high"]` | 优先级 |
| `created_by` | string | `defaultFrom: "currentUser.id"` | 创建者 |

记录级权限：
- 负责人能读、能更新 status / priority
- 创建者能读、能删除（管理自己分配的任务）

### 目录类（catalog）

适用：产品目录、知识库、字典表、配置项等"管理员维护、所有人只读"的应用。

推荐字段：
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `name` | string | required, unique | 名称 |
| `description` | string | | 描述 |
| `enabled` | boolean | `defaultValue: true` | 是否启用 |
| `sort_order` | number | `defaultValue: 0` | 排序 |

权限：
- 所有人可读（`read: { mode: "authenticated" }`）
- 仅页面所有者或管理员能 create/update/delete

## schema business 元数据格式

字段结构写在 SQL migration 中，业务元数据在 `manifest.json` 的 `business.<table>` 中声明：

```sql
CREATE TABLE leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  reviewed_by TEXT
);
```

```json
{
  "business": {
    "leaves": {
      "kind": "request",
      "ownerField": "created_by",
      "statusField": "status",
      "statuses": ["draft", "submitted", "approved", "rejected"],
      "recordAccess": {
        "read": { "mode": "ownerField", "field": "created_by" },
        "update": {
          "mode": "ownerField",
          "field": "created_by",
          "when": { "status": ["draft"] }
        },
        "delete": {
          "mode": "ownerField",
          "field": "created_by",
          "when": { "status": ["draft"] }
        }
      }
    }
  }
}
```

字段含义：
- `kind`：业务形态（`request` / `assignment` / `catalog` / `personal`），主要给 Agent 和文档参考
- `ownerField`：记录所有者字段名，对应 `recordAccess` 中 `mode: "ownerField"` 的字段
- `assigneeField`：分配对象字段名，对应 `mode: "assigneeField"`
- `aclField`：访问控制列表字段名，对应 `mode: "aclField"`
- `statusField` + `statuses`：状态字段和合法值
- `recordAccess`：按动作（read/create/update/delete）声明策略

## 记录级访问模式

`recordAccess.<action>` 支持四种模式：

| 模式 | 语义 | 判断 |
|------|------|------|
| `authenticated` | 登录即可 | visitor 存在 |
| `ownerField` | 记录所有者 | `record[field] === currentUser.id` |
| `assigneeField` | 被分配人 | `record[field] === currentUser.id` |
| `aclField` | ACL 列表包含 | `record[field]` 包含 `currentUser.id` |

附加 `when` 条件限制状态：
```json
{
  "mode": "ownerField",
  "field": "created_by",
  "when": { "status": ["draft"] }
}
```
表示"所有者且状态为 draft 时才能执行该动作"。

页面所有者（page owner）始终绕过记录级策略——在自己页面上能看到所有记录。

## 当前用户默认值（defaultFrom）

字段约束 `defaultFrom` 让后端在创建记录时自动填充：

- `"currentUser.id"`：填入当前用户 ID
- `"currentUser.name"`：填入当前用户显示名

请求体中显式传入同名字段时**会被后端覆盖**——这是为了防止前端伪造归属。

未登录用户对包含 `defaultFrom` 字段的 schema 创建记录时返回 401。

## 前端权限 UI

后端会自动执行记录级权限；前端用 SDK 同步判断显示哪些按钮：

```tsx
import { usePermissions, Can } from "@localapp/sdk-react";
import type { DataSchemaLike } from "@localapp/sdk-react";

const leaveSchema: DataSchemaLike = {
  business: {
    ownerField: "created_by",
    statusField: "status",
    recordAccess: {
      update: { mode: "ownerField", field: "created_by", when: { status: ["draft"] } },
    },
  },
};

function LeaveRow({ leave }: { leave: Leave }) {
  const { can } = usePermissions();
  const editable = can("update", leave, leaveSchema);
  return (
    <div>
      <span>{leave.title}</span>
      {editable && <Button size="sm">编辑</Button>}
    </div>
  );
}

// 或用 <Can> 组件
function LeaveRowDeclarative({ leave }: { leave: Leave }) {
  return (
    <div>
      <span>{leave.title}</span>
      <Can action="update" record={leave} schema={leaveSchema} fallback={null}>
        <Button size="sm">编辑</Button>
      </Can>
    </div>
  );
}
```

**重要**：`usePermissions()` 和 `<Can>` 仅用于 UI 展示判断，后端 CRUD API 才是
记录级权限的安全边界。即使前端隐藏了按钮，直接调用 API 仍会经过完整的
权限校验。

## 常见场景

### 用户只能看自己的记录

```json
"recordAccess": {
  "read": { "mode": "ownerField", "field": "created_by" }
}
```
配合 `defaultFrom: "currentUser.id"` 在 created_by 字段上，列表自动只返回当前用户的记录。

### 草稿可编辑，提交后不可编辑

```json
"recordAccess": {
  "update": {
    "mode": "ownerField",
    "field": "created_by",
    "when": { "status": ["draft"] }
  }
}
```

### 负责人才能更新任务

```json
"recordAccess": {
  "update": { "mode": "assigneeField", "field": "assignee_id" }
}
```

### 全员可读，仅管理员可写

```json
"recordAccess": {
  "read": { "mode": "authenticated" },
  "create": { "mode": "authenticated" },
  "update": { "mode": "authenticated" },
  "delete": { "mode": "authenticated" }
}
```
（实际管理权限由页面 `pageAccess` 或路由 `routeAccess` 控制。）

## 开发模式验证业务规则

业务建模完成后运行 `localapp dev`，用 Dev Toolkit 做四类检查：

- Identity：切换申请人、负责人、审批人和未登录用户，确认 `recordAccess` 只返回当前视角应看到的记录。
- Time：固定 ISO 时间，执行包含 `"now"` 的 transition，确认时间字段、进度和截止日期视图稳定可复现。
- Data：通过 Dev Toolkit 让当前统一 Server 重置应用数据库，并用 snapshot/restore 快速回到关键业务状态。
- Diagnostics：查看 `manifest.business` 展示的 `recordAccess`、`defaultFields`、`transitions`、`enums` 是否与预期一致。

Dev Toolkit 操作后会触发 SDK hooks 自动刷新；不要通过前端硬编码过滤来模拟后端权限。

## 反模式

- ❌ 在 React 中用 `rows.filter(r => r.created_by === me.id)` 实现权限——前端过滤绕过服务端，应该在 named SQL 的 WHERE 子句里加 `created_by = :currentUserId`
- ❌ 用 raw SQL `useExec` 替代 named SQL 实现业务接口——raw SQL 端点已移除，且 named SQL 才能注入 `:currentUserId` 系统变量
- ❌ 在前端拼 `created_by: me.id` 写入请求——应该在 SQL 里直接用 `:currentUserId` 系统变量，前端伪造值会被忽略
- ❌ 为每种业务单独发明字段名（applicant、owner、creator 混用）——遵循本指南的 `created_by` / `assignee_id` / `reviewed_by` 约定

## 与其他 skill 的关系

- 字段类型、CRUD Hook 完整 API：见 `localapp-data.md`
- 用户身份、群组、ACL、登录：见 `localapp-auth.md`
- UI 组件：见 `localapp-ui.md`

## 业务状态变化用 transition mutation

带 `statusField` 的业务模型（请假/报销/任务等）几乎都需要状态迁移。
**不要用 `useUpdate` 直接改 status 字段**——它会绕过状态机合法性。

正确做法（两段式）：
1. 在 `business.transitions[]` 中声明合法迁移（前端 UI 元数据）
2. 在 `backend/resources/<table>/mutations.json` 声明对应的 named mutation（实际执行入口）
3. 前端用 `useTransitions(resource, record, schema)` 本地计算可用按钮，调用 `transition(name)` 触发 mutate

```json
"business": {
  "statusField": "status",
  "initialStatus": "draft",
  "transitions": [
    { "name": "submit", "label": "提交", "from": ["draft"], "to": "submitted" }
  ]
}
```

```json
// backend/resources/leaves/mutations.json
"$leaves.submit": {
  "kind": "mutation",
  "access": "owner",
  "params": { "id": { "type": "number", "required": true } },
  "sql": "UPDATE leaves SET status='submitted', submitted_at=:now WHERE id=:id AND status='draft' AND created_by=:currentUserId"
}
```

```tsx
import { useTransitions } from "@localapp/sdk-react";
const { transitions, transition } = useTransitions("leaves", leave, leaveSchema);
transitions.map(t => <Button onClick={() => transition(t.name)}>{t.label}</Button>)
```

详细 transition 建模规则、SQL 守卫模板、access 字段配置见 `localapp-transitions.md`。
