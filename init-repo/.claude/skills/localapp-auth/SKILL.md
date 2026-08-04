---
name: localapp-auth
description: >
  LocalApp 认证与权限控制指南——用户身份查询、登录跳转、访问控制配置。
  当用户要在 LocalApp 项目中处理用户登录状态、权限控制、根据登录状态显示不同内容、
  配置页面访问权限、设置路由级权限时触发。
  也适用于用户说"登录"、"权限"、"认证"、"只有自己能看"、"需要登录才能访问"、
  "访问控制"、"角色"等场景。
---

# LocalApp 认证与权限

LocalApp 内置用户认证和双层访问控制，不需要写后端代码。

## 用户身份

### useMe() — 查询当前访客

```tsx
import { useMe } from "@localapp/sdk-react";

function App() {
  const { me, loading, error } = useMe();
  // me: { id: string, name: string } | null
  // 未登录时 me 为 null

  if (loading) return <p>加载中...</p>;

  return (
    <div>
      {me
        ? <p>欢迎, {me.name}!</p>
        : <p>请登录后继续</p>}
    </div>
  );
}
```

应用运行在 LocalApp native shell 内，`useMe` 自动检测平台 session cookie，无需额外配置。

### redirectToLogin() — 在当前应用打开平台登录框

```tsx
import { redirectToLogin } from "@localapp/sdk";

// 点击按钮跳转
<button onClick={redirectToLogin}>登录</button>

// 检测到未登录自动跳转
if (error?.status === 401) {
  redirectToLogin();
}
```

在当前 native shell 页面原地打开平台登录框，登录成功后自动返回并继续访问当前应用。DevShell 中会打开“开发工具 → 身份”面板供开发者选择模拟身份。若当前页面没有 Shell，则回退到平台首页。应用不需要也不得直接操作平台 DOM。

## 访问控制

两层权限，声明式配置：

```
┌─────────────────────────────────────────────┐
│  页面级 (pageAccess)                         │
│  "谁能看到这个页面"                           │
│  ┌─────────────────────────────────────┐    │
│  │  路由级 (routeAccess)                │    │
│  │  "谁能操作特定数据"                   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 四种访问级别

| 级别 | 说明 |
|------|------|
| `public` | 任何人可访问，包括未登录用户 |
| `authenticated` | 需要登录 |
| `owner` | 仅页面所有者 |
| `acl` | 指定用户列表 |

ACL 格式：`{ "level": "acl", "acl": ["alice", "bob"] }`

### 页面级权限

控制谁能看到整个页面。通过 API 设置：

```bash
# 设为需要登录才能访问
# PUT /api/pages/<page-name>
# Body: { "pageAccess": { "level": "authenticated" } }
```

或者通过 CLI（如果有对应命令的话），也可以在 `localapp pages info` 查看当前设置。

### 路由级权限

控制谁能对特定数据表执行 CRUD 操作。表结构通过 SQL migration 创建：

```sql
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_by TEXT
);
```

权限通过 `manifest.json` 的 `db.defaultAccess` 和 `manifest.business` 指定：
```json
{
  "db": {
    "mode": "crud",
    "defaultAccess": {
      "read": "public",
      "create": "authenticated",
      "update": "owner",
      "delete": "owner"
    }
  },
  "business": {
    "comments": {
      "ownerField": "created_by",
      "recordAccess": { "update": "owner", "delete": "owner" }
    }
  }
}
```

`routeAccess` 支持的键：`read` / `create` / `update` / `delete`

### manifest.json 全局默认权限

当 schema 没有指定 routeAccess 时，使用 manifest.json 的全局默认：

```json
{
  "db": {
    "mode": "crud",
    "defaultAccess": {
      "read": "public",
      "create": "authenticated",
      "update": "owner",
      "delete": "owner"
    }
  }
}
```

### 记录级权限（recordAccess）

routeAccess 控制的是"谁能对这张表执行 CRUD"，recordAccess 进一步控制"具体哪些记录可见/可改"。在 schema `business.recordAccess` 中声明：

```json
"business": {
  "ownerField": "created_by",
  "recordAccess": {
    "read": { "mode": "ownerField", "field": "created_by" },
    "update": { "mode": "ownerField", "field": "created_by", "when": { "status": ["draft"] } }
  }
}
```

后端 CRUD 自动执行；前端用 `usePermissions()` / `<Can>` 同步判断 UI。详细约定见 `localapp-business.md`。

### 开发模式验证身份和权限

运行 `localapp dev` 后，用 Dev Toolkit 的 **Identity** 分区切换 `dev-user` / `alice` / `bob` / 未登录，验证：

- `useMe()` 是否返回当前模拟用户或 `null`
- `defaultFrom: "currentUser.id"` 是否由后端自动填充
- `recordAccess` owner / assignee / acl 策略是否过滤列表、详情和按钮
- 未登录用户创建含 `defaultFrom` 的记录是否返回 401

切换身份后 DevShell 会派发 `localapp:dev-context-changed`，数据 hooks 会自动刷新；不要为了测试权限在 React 里手动伪造用户字段。

## 前端权限判断（UI 展示）

后端访问控制是安全边界；前端用以下 API 决定显示哪些按钮：

### usePermissions() — 记录级权限判断

```tsx
import { usePermissions } from "@localapp/sdk-react";
import type { DataSchemaLike } from "@localapp/sdk-react";

const schema: DataSchemaLike = {
  business: {
    ownerField: "created_by",
    recordAccess: {
      update: { mode: "ownerField", field: "created_by", when: { status: ["draft"] } },
    },
  },
};

function LeaveRow({ leave }: { leave: Leave }) {
  const { can, loading } = usePermissions();
  if (loading) return null;
  const editable = can("update", leave, schema);
  return (
    <div>
      <span>{leave.title}</span>
      {editable && <button>编辑</button>}
    </div>
  );
}
```

### `<Can>` 组件 — 声明式权限渲染

```tsx
import { Can } from "@localapp/sdk-react";

<Can action="update" record={leave} schema={schema} fallback={<span>已锁定</span>}>
  <button>编辑</button>
</Can>
```

`fallback` 可选，默认不渲染任何内容。

**重要**：`usePermissions()` 和 `<Can>` 仅用于 UI 展示判断（如隐藏不可用的按钮），
后端 CRUD API 才是记录级权限的安全边界。即使前端隐藏了按钮，直接调用 API
仍会经过完整的权限校验。

## 常见模式

### 根据登录状态显示不同内容

```tsx
import { useMe } from "@localapp/sdk-react";
import { redirectToLogin } from "@localapp/sdk";

function App() {
  const { me, loading } = useMe();

  if (loading) return <p>加载中...</p>;

  return (
    <div>
      {me ? (
        <p>欢迎回来, {me.name}!</p>
      ) : (
        <p>请 <button onClick={redirectToLogin}>登录</button> 后继续</p>
      )}
    </div>
  );
}
```

### 未登录自动跳转

```tsx
import { useList } from "@localapp/sdk-react";
import { redirectToLogin } from "@localapp/sdk";

function PrivatePage() {
  const { rows, loading, error } = useList("posts");

  if (error?.status === 401) {
    redirectToLogin();
    return <p>正在跳转登录...</p>;
  }
  if (error?.status === 403) {
    return <p>你没有权限访问此页面</p>;
  }
  if (loading) return <p>加载中...</p>;

  return <ul>{rows.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

### 错误处理

所有 Hook 返回 `error` 字段，类型为 `LocalAppError`：

```tsx
import { LocalAppError } from "@localapp/sdk";

// 查询 Hook
const { error } = useList("posts");
if (error) {
  if (error.status === 401) { /* 未登录 */ }
  if (error.status === 403) { /* 无权限 */ }
  if (error.status === 404) { /* 资源不存在 */ }
}

// 变更 Hook 用 try/catch
try {
  await create({ title: "Hello" });
} catch (e) {
  if (e instanceof LocalAppError && e.status === 401) {
    redirectToLogin();
  }
}
```

常见状态码：
- `401` — 未登录
- `403` — 已登录但无权限
- `404` — 资源不存在
- `0` — 网络错误
