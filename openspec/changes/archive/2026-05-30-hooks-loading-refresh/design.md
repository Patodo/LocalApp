## Context

SDK mutation hooks 只返回 async 函数，无状态追踪。开发者需要禁用按钮、显示 spinner 时需自行管理状态。

## Goals / Non-Goals

**Goals:**
- Mutation hooks 返回 loading/error 状态
- useCount 暴露 refresh 方法
- 向后兼容

**Non-Goals:**
- 不实现全局 query invalidation
- 不添加 optimistic updates

## Decisions

错误仍 throw（不吞异常），同时设置 error state。理由：现有代码依赖 try/catch，突然不 throw 会破坏错误处理。

## Risks / Trade-offs

- **[Risk] loading 初始值为 false** — 正确：mutation 只在调用时 loading，不像 read hooks 初始 true
