LocalApp Agent 工具编写指南。当编写或修改 useAgent({ tools }) 的自定义工具时，或用户提到"agent 工具"、"自定义工具"、"写操作工具"、"agent tool"时触发。提供正确的工具编写模式，确保 agent 通过前端组件操作数据而非直接调 API。

# Agent 工具编写模式

## 核心原则：通过前端组件操作，不直接调 API

Agent 的写操作必须通过 React 状态管理和 SDK Hook（useCreate、useUpdate、useDelete）执行，不能直接用 fetch 调 REST API。

原因：
1. **权限一致性** — SDK Hook 内部走的 API 调用带完整的校验和 ACL，和用户手动操作表单走同一路径
2. **用户可见性** — 操作前端组件意味着用户能看到表单在填、数据在变，agent 不是在后台默默改数据库
3. **状态一致性** — React 状态和数据库状态保持同步，不会出现 UI 显示的和数据库不一致

## 正确模式

### 模式一：表单填写 + 提交

适合有表单的应用。Agent 分两步操作：先填字段，再提交表单。

```tsx
import { useState } from "react";

function App() {
  const [formData, setFormData] = useState({ title: "", content: "" });
  const { create } = useCreate("posts");
  const { refresh } = useList("posts");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await create(formData);
    setFormData({ title: "", content: "" });
    refresh();
  };

  const agent = useAgent({
    tools: {
      fillField: {
        description: "填写表单中的指定字段",
        parameters: {
          field: { type: "string", required: true, description: "字段名" },
          value: { type: "string", required: true, description: "要填写的值" },
        },
        execute: async (args) => {
          setFormData(prev => ({ ...prev, [args.field as string]: args.value }));
          return `已填写 ${args.field}`;
        },
      },
      submitForm: {
        description: "提交当前表单",
        parameters: {},
        execute: async () => {
          if (!formData.title) return "缺少必填字段: title";
          await create(formData);
          setFormData({ title: "", content: "" });
          refresh();
          return "提交成功";
        },
      },
    },
    systemHint: "用户会描述想要提交的内容，先用 fillField 填好表单，再用 submitForm 提交。",
  });

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1 }}>
        <form onSubmit={handleSubmit}>
          <input value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} />
          <input value={formData.content} onChange={e => setFormData(p => ({...p, content: e.target.value}))} />
          <button type="submit">提交</button>
        </form>
      </div>
      <div style={{ width: 400 }}>
        <AgentChat agent={agent} />
      </div>
    </div>
  );
}
```

### 模式二：直接操作数据

适合没有表单、直接管理数据的场景（如列表页删除、切换状态）。

```tsx
function App() {
  const { create } = useCreate("todos");
  const { update } = useUpdate("todos");
  const { remove } = useDelete("todos");
  const { rows, refresh } = useList("todos");

  const agent = useAgent({
    tools: {
      addTodo: {
        description: "添加待办事项",
        parameters: {
          title: { type: "string", required: true, description: "标题" },
        },
        execute: async (args) => {
          await create({ title: args.title as string, done: false });
          refresh();
          return `已添加: ${args.title}`;
        },
      },
      toggleTodo: {
        description: "切换待办事项的完成状态",
        parameters: {
          id: { type: "number", required: true, description: "待办 ID" },
        },
        execute: async (args) => {
          const todo = rows.find(r => r.id === args.id);
          if (!todo) return `未找到 ID ${args.id}`;
          await update(args.id as number, { done: !todo.done });
          refresh();
          return `已${todo.done ? "取消完成" : "完成"}: ${todo.title}`;
        },
      },
      deleteTodo: {
        description: "删除待办事项",
        parameters: {
          id: { type: "number", required: true, description: "待办 ID" },
        },
        execute: async (args) => {
          await remove(args.id as number);
          refresh();
          return `已删除 ID ${args.id}`;
        },
      },
    },
    systemHint: "用户会要求管理待办事项，使用工具执行操作。",
  });

  // ...render
}
```

## 反模式：直接 fetch 调 API

```tsx
// ❌ 错误：绕过了 React 状态和 SDK Hook
const agent = useAgent({
  tools: {
    createPost: {
      description: "创建文章",
      parameters: { title: { type: "string", required: true } },
      execute: async (args) => {
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        return res.json();
      },
    },
  },
});
```

这会导致：
- 前端 UI 不更新（React 状态不知道数据变了）
- 用户看不到 agent 做了什么
- 绕过了 SDK 内置的路径解析（detectBasePath）和错误处理

## 工具函数闭包安全性

`useAgent` 内部通过 `optionsRef.current` 延迟引用工具函数。组件每次重渲染时，工具 `execute` 函数自动获取最新的闭包值（state、props、Hook 返回值等）。

**你不需要用 `useCallback` 包裹 `execute` 函数。** 直接使用组件作用域中的变量，它们始终是最新的：

```tsx
const [count, setCount] = useState(0);
const { rows } = useList("todos");

const agent = useAgent({
  tools: {
    getState: {
      description: "获取当前状态",
      parameters: {},
      execute: async () => {
        // count 和 rows 始终是最新值，无需担心闭包过期
        return `当前计数: ${count}, 待办数: ${rows.length}`;
      },
    },
  },
});
```

这种设计确保了 Agent 回调中访问的 React 状态与 UI 渲染的状态完全一致。

## 工具设计检查清单

1. 写操作工具是否调用了 `useCreate`/`useUpdate`/`useDelete` 的返回函数？
2. 操作后是否调用了 `refresh()` 刷新列表？
3. 表单填写工具是否通过 `setState` 更新 React 状态？
4. 没有直接使用 `fetch` 调 REST API？
5. `systemHint` 是否指导 LLM 使用正确的工具调用顺序？
