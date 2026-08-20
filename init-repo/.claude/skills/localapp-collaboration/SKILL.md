---
name: localapp-collaboration
description: >
  LocalApp 多人协作指南。当应用需要 CRDT、Yjs、多人同时编辑、离线合并、协作光标、
  标记谁正在编辑字段或用遮罩显示编辑区域时触发。
---

# LocalApp 实时协作

LocalApp 提供两种互补协作模型。业务表单、任务和审批记录优先使用 named SQL；需要显式保存冲突时使用
`record-versioned`。只有文本、富文本、白板或结构化共享文档等必须自动合并的内容才使用可选
`@localapp/crdt`。不要创建应用私有 WebSocket Server 或第二套用户系统。

## 启用 CRDT

应用模板已把 `@localapp/crdt` 作为可选内置包。使用时在 `manifest.json` 同时声明平台要求和资源：

```json
{
  "platformVersion": "^1.3",
  "requires": {
    "backend": "named-sql",
    "identity": ["currentUser", "pageOwner"],
    "primitives": ["crdt", "editing-awareness-overlay"]
  },
  "collaboration": {
    "enabled": true,
    "overlay": true,
    "resources": {
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

`read` 可为 `public | authenticated | owner | acl`；`write` 不允许 `public`。使用 `acl` 时声明用户 ID 或
`group:<name>`。权限按整份文档执行，字段级秘密必须拆成不同资源或文档。

## React 用法

```tsx
import { useLocalAppCrdt, useEditingTarget } from "@localapp/crdt/react";

const { provider, doc, status, peers } = useLocalAppCrdt({
  resource: "documents",
  documentId: `proposal-${proposalId}`,
});

useEditingTarget(provider, {
  surfaceId: `proposal:${proposalId}`,
  fieldId: "title",
  label: "标题",
}, titleFocused);

const title = doc.getText("title");
```

编辑器本身负责把输入绑定到 `Y.Text`、`Y.Map` 或 `Y.Array`。富文本、CodeMirror、Monaco 等使用对应的
Yjs binding；不要在 React state 与 Yjs 之间双向全量覆盖。

## Editing Awareness 遮罩

应用只声明稳定目标，不发送 CSS selector 或用户资料：

```tsx
<section data-localapp-edit-surface={`proposal:${proposalId}`}>
  <input data-localapp-edit-field="title" />
</section>
```

Server 从当前 Session 生成用户 ID、姓名、头像和颜色；Platform Shell 只在
`[data-localapp-app-root]` 内精确匹配这些 data attribute，并绘制不拦截交互的半透明遮罩。自己的 client 不会
显示为远端遮罩；失焦、卸载或离线超时后状态自动清除。

`surfaceId` / `fieldId` 必须稳定，不使用数组下标。虚拟列表重新挂载后保留相同 ID。选区位置使用包导出的
`encodeRelativePosition()` / `decodeRelativePosition()`，不要保存绝对字符 offset。

## 验证

1. 两个独立登录 Session 同时编辑同一文档，确认双方最终 `Y.Doc` 收敛。
2. 断网编辑后恢复，确认本地更新上传且没有 revision 冲突。
3. 只读、未登录和错误 ACL 写入必须失败。
4. 在一个页面聚焦标记字段，另一页面必须看到姓名遮罩；失焦或关闭页面后遮罩消失。
5. 滚动、响应式变化和目标重新挂载后遮罩继续跟随，且遮罩层保持 `pointer-events: none`。
6. 通过正式 `/<owner>/<app>/` URL 使用应用内 Browser 验收，不以 raw `/serve/` 页面代替。
