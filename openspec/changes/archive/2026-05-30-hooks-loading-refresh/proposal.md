## Why

Agent 测试反馈 mutation hooks（useCreate/useUpdate/useDelete）无 loading/error 状态，开发者必须自行 try/catch。useCount 在数据变更后不刷新。这些是 DX 评分 7-8/10 的主要扣分项。

## What Changes

- useCreate/useUpdate/useDelete 添加 `loading` 和 `error` 返回字段
- useCount 添加 `refresh` 方法
- 错误仍然 throw（保持向后兼容），同时设置 error 状态

## Capabilities

### Modified Capabilities
- `sdk-react`: mutation hooks 增加 loading/error，useCount 增加 refresh

## Impact

- `packages/sdk-react/src/hooks/use-create.ts` — 添加 useState loading/error
- `packages/sdk-react/src/hooks/use-update.ts` — 同上
- `packages/sdk-react/src/hooks/use-delete.ts` — 同上
- `packages/sdk-react/src/hooks/use-count.ts` — 添加 refresh 方法
- 向后兼容：新增字段不影响现有代码
