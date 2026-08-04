## Why

Agent 测试反馈 useList filter 仅支持精确匹配，无法实现日期范围等常见查询。useExec 无 error 状态导致错误被静默吞掉。

## What Changes

- buildWhereClause 支持 __gte/__lte/__gt/__lt/__ne/__like 运算符后缀
- useExec hook 添加 error 返回字段
- 更新文档

## Impact

- packages/server/src/lib/app-db.ts — filter 运算符
- packages/sdk-react/src/hooks/use-exec.ts — error state
