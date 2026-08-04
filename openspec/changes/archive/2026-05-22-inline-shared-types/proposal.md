## Why

`@localapp/shared` 包目前只有 server 一个消费者（client 不引用它，CLI 是 Rust）。单独维护一个包——包含 package.json、tsconfig、build 步骤和 workspace 依赖声明——属于过度抽象，增加了构建复杂度却没有带来复用收益。

## What Changes

- 将 `packages/shared/src/` 下的类型文件（models.ts、api.ts、mcp.ts、index.ts）移入 `packages/server/src/types/`
- 将 server 中所有 `import ... from "@localapp/shared"` 替换为相对路径引用
- 删除 `packages/shared/` 目录
- 从根 `pnpm-workspace.yaml` 移除 shared（如显式声明）
- 从 server 的 `package.json` 移除 `@localapp/shared` 依赖
- 更新根 `tsconfig.json` 的 references，移除 shared

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shared-types`: 类型定义从独立包迁移到 server 内部目录，barrel 导出路径变更
- `monorepo-structure`: workspace 从 3 个 TS 子包变为 2 个（server + client），根 tsconfig references 移除 shared

## Impact

- `packages/shared/` — 整个目录删除
- `packages/server/` — 7 个文件的 import 路径替换，新增 `src/types/` 目录
- `pnpm-workspace.yaml` — 可能无需改动（`packages/*` 通配符仍匹配）
- 根 `tsconfig.json` — references 移除 shared
- `packages/server/package.json` — 移除 `@localapp/shared` workspace 依赖
