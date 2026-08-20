# CRDT 协作与编辑位置遮罩设计

## 目标

LocalApp 在现有记录级 revision 协作之外，提供一个应用按需引入的
`@localapp/crdt` 内置包，用于文本、富文本、白板和结构化文档等需要离线编辑、并发合并的场景。
统一 Server 负责认证、授权、CRDT 更新持久化和传输；应用只选择共享数据类型、编辑器绑定与业务界面。

同时提供平台级 Editing Awareness。协作者进入字段或编辑区域后，其他用户会在对应页面内容上看到
半透明遮罩、彩色边框和用户标签。遮罩由 Platform Shell 绘制，不改变应用布局，也不拦截鼠标和键盘事件。

## 产品边界

- `record-versioned` 继续用于表单、任务和普通业务记录，使用 revision 冲突检测。
- `crdt` 用于需要自动合并的共享文档。第一版采用 Yjs 更新格式和共享类型。
- 两种模式可以在同一应用中并存，但同一个资源只能声明一种模式。
- CRDT 文档属于某个 Server 上的某个应用，不在多个 peer Server 间实时同步。显式“应用加数据”快照会随
  `app.db` 一并复制 CRDT 持久状态，但不会复制在线状态。
- Awareness、光标、选区和编辑目标是瞬时数据，永不写入应用数据库或备份。
- 第一版不是端到端加密协作；Server 必须能够执行访问控制并验证更新大小。

## 包与依赖

新增可选运行时包：

```json
{
  "optionalDependencies": {
    "@localapp/crdt": "workspace:*"
  }
}
```

CLI 将该包与其他 SDK 一起放入 builtin template。新项目可以直接安装或移除它；没有启用 CRDT 的应用
不会把 Yjs 打进前端产物，也不会建立 CRDT 连接。核心包保持与 React 无关，同时导出 `./react` 入口提供
生命周期 Hook。

## Manifest

现有 `manifest.collaboration.resources` 扩展为两类资源：

```json
{
  "platformVersion": "^1.3",
  "requires": {
    "primitives": ["crdt", "editing-awareness-overlay"]
  },
  "collaboration": {
    "enabled": true,
    "overlay": true,
    "resources": {
      "tasks": {
        "mode": "record-versioned",
        "mutation": "$tasks.collaborativeUpdate",
        "history": true
      },
      "documents": {
        "mode": "crdt",
        "read": "authenticated",
        "write": "authenticated",
        "maxDocumentBytes": 5242880,
        "awareness": true,
        "overlay": true
      }
    }
  }
}
```

- `read` 支持 `public | authenticated | owner | acl`。
- `write` 只支持 `authenticated | owner | acl`，禁止匿名写入。
- `acl` 使用平台用户 ID 或 `group:<name>`，与其他平台 ACL 语义一致。
- `maxDocumentBytes` 是合并后文档上限，不能高于平台硬上限。
- `awareness` 控制编辑状态传输；`overlay` 控制是否允许 Platform Shell 绘制字段遮罩。
- 安装时验证配置、限制、ACL 和引用的 record-versioned mutation，非法包不进入运行态。
- 使用 CRDT 的应用必须声明 `platformVersion: ^1.3`，并在 `requires.primitives` 中声明实际使用的
  `crdt` / `editing-awareness-overlay`，让 `localapp check` 在发布前拦截不兼容 Server。

后续若需要每份文档独立权限，可增加只读 Named SQL `authorize` 查询；第一版使用资源级访问策略，业务应用
应按权限边界拆分资源。

## Server 数据模型

CRDT 状态保存在应用自身 `app.db` 的平台保留表：

```sql
CREATE TABLE _localapp_crdt_documents (
  resource TEXT NOT NULL,
  document_id TEXT NOT NULL,
  snapshot BLOB NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource, document_id)
);
```

Server 收到更新后：

1. 验证应用、资源、访问者身份、文档 ID 和请求大小。
2. 在应用数据库队列和事务内读取当前 snapshot。
3. 使用 Yjs 将当前 snapshot 与增量更新合并；更新具有交换、结合和幂等性。
4. 对合并结果重新编码并检查 `maxDocumentBytes`。
5. 原子写回 snapshot，再向同一应用、资源和文档的 SSE 订阅者广播更新。

状态向量同步用于重连：客户端提交本地 state vector，Server 只返回缺失更新。数据库备份、恢复、应用加数据
同步和失败回滚无需特殊分支，因为 CRDT 表位于应用数据库内。

## 传输协议

所有端点位于正式应用 API 根路径并沿用浏览器 Session：

- `POST /api/crdt/sync`：提交 `{ resource, documentId, stateVector }`，返回缺失 update。
- `POST /api/crdt/update`：提交 base64url Yjs update，事务持久化并广播。
- `GET /api/crdt/events?resource=&documentId=`：SSE 推送 `crdt:update` 和连接状态。
- `POST /api/crdt/awareness`：刷新或清除当前 client 的瞬时编辑状态。

客户端断线时保留本地 `Y.Doc`，更新进入有界发送队列；重连后先交换 state vector，再继续发送。更新可以重复
提交，Server 合并保持幂等。第一版使用 HTTP + SSE，方便复用 LocalApp 的认证、代理和生命周期；未来可以
在不改变包 API 的情况下增加 WebSocket transport。

## Awareness 与身份可信边界

应用只能提交以下编辑目标，不能提交任意 CSS selector、用户名、头像或颜色：

```ts
type EditingTarget = {
  surfaceId: string;
  fieldId?: string;
  label?: string;
  kind?: "field" | "selection" | "canvas";
  selection?: { anchor: string; head: string };
};
```

- `surfaceId` 和 `fieldId` 只能使用稳定 ID 字符集，Server 做长度和格式校验。
- Server 从当前 Session 覆盖 `user.id/name/displayName/avatarUrl`，并根据用户 ID 生成稳定颜色；不信任客户端身份。
- client 只能修改自己的 awareness 条目，clock 必须递增。
- 条目 30 秒没有刷新即过期；客户端每 15 秒刷新，离开时发送 `state: null`。
- 选区使用 Yjs Relative Position 编码，使远端插入或删除后仍指向相同逻辑位置。

## 页面遮罩协议

应用用稳定属性标记可编辑区域：

```html
<section data-localapp-edit-surface="resume:42">
  <input data-localapp-edit-field="candidate-name" />
</section>
```

`@localapp/crdt` 收到远端 Awareness snapshot 后，通过同页受限事件把规范化 peer 列表交给 Platform Shell。
Shell 只允许在 `[data-localapp-app-root]` 内匹配精确的 `data-localapp-edit-surface` 和
`data-localapp-edit-field`，不会执行远端传来的 selector。

遮罩层具有以下行为：

- 定位在应用内容上方、平台弹窗下方，`pointer-events: none`；
- 使用用户稳定颜色绘制半透明背景、2px 边框和姓名标签；
- 同一字段多人编辑时堆叠姓名，不重复遮罩；
- 监听滚动、窗口缩放、DOM mutation 与 ResizeObserver，持续跟随目标位置；
- 目标暂时未渲染、虚拟列表移出视口或隐藏时不显示，重新出现后自动恢复；
- 当前用户自己的编辑状态不显示为远端遮罩；
- `prefers-reduced-motion` 下禁用过渡动画，并提供屏幕阅读器状态文本。

富文本编辑器可以使用包提供的 adapter 将 Relative Position 转成 DOM Range，得到光标或选区级遮罩；没有
adapter 时自动降级为字段级遮罩。

## 应用 API

```ts
import * as Y from "yjs";
import { createLocalAppCrdt } from "@localapp/crdt";

const doc = new Y.Doc();
const provider = createLocalAppCrdt({
  resource: "documents",
  documentId: "proposal-42",
  doc,
});

provider.setEditingTarget({
  surfaceId: "proposal:42",
  fieldId: "body",
  label: "正文",
});
```

Provider 暴露连接状态、远端 awareness、错误订阅和销毁方法。React 入口提供 `useLocalAppCrdt` 与
`useEditingTarget`，只管理生命周期，不规定编辑器。ProseMirror/Tiptap、CodeMirror、Monaco 和 Quill 继续
使用各自官方 Yjs binding。

## 安全与限制

- 更新和 state vector 都有独立请求上限；base64 解码后再次检查大小。
- 文档 ID、资源名、Awareness 文本和并发连接数受限。
- Server 在广播前完成持久化，客户端收到事件即代表更新已进入 Server 数据库。
- CRDT 更新是不透明二进制，Server 无法从更新内容推断字段权限，所以授权必须在文档入口完成。
- Awareness 不参与业务决策；即使客户端丢失遮罩，也不影响 CRDT 正确性。
- 多实例 Server 部署时，SSE 广播和 Awareness 需要共享 pub/sub；单实例版本先使用进程内 fan-out，持久文档
  已满足重启恢复。
- 正式数据与每个隔离 verification session 使用不同事件 channel；验收流量不会广播到正式用户或污染正式遮罩。

## 验收标准

1. 未安装 `@localapp/crdt` 的应用构建与运行行为不变。
2. 两个登录用户离线或并发编辑同一 Y.Text，重连后内容收敛且无 revision 冲突。
3. 更新在 Server 重启、应用备份恢复和应用加数据同步后仍存在。
4. 未登录、只读用户、非法资源、非法文档 ID、超限和损坏更新均被拒绝。
5. Awareness 身份由 Server 生成，伪造用户名、颜色和其他 client ID 无效。
6. 用户聚焦字段后，另一浏览器在对应 DOM 区域看到遮罩、边框和用户标签；离开或超时后消失。
7. 滚动、响应式布局和虚拟化重新挂载后遮罩位置仍正确，且不会遮挡点击。
8. 核心包、React Hook、Server 集成、manifest 校验和 Shell 遮罩均有自动化测试。
