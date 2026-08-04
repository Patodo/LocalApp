## Context

当前 `packages/shared/` 是独立的 TypeScript 子包（`@localapp/shared`），包含 4 个文件：models.ts、api.ts、mcp.ts、index.ts。经调查，只有 server 包通过 workspace 依赖引用它，client 不引用，CLI 是 Rust 项目。

```
packages/shared/src/        → 移入 →  packages/server/src/types/
  models.ts                             models.ts
  api.ts                                api.ts
  mcp.ts                                mcp.ts
  index.ts                              index.ts
```

## Goals / Non-Goals

**Goals:**
- 消除只有一个消费者却独立成包的过度抽象
- 减少 workspace 依赖解析和构建步骤
- 保持所有类型定义在一个目录内，便于维护

**Non-Goals:**
- 不重新组织类型文件内容（仅移动位置）
- 不改变类型本身（不增删改类型定义）
- 不修改 client 包的内部类型定义方式

## Decisions

### 目标目录：`packages/server/src/types/`

**选择**: 放在 `server/src/types/` 作为内部模块
**替代方案**: `server/src/models/` — 但 types 语义更准确，包含 models + api + mcp 三类
**理由**: 与现有 `server/src/lib/`（运行时代码）平级，types 明确表示"纯类型定义"

### 导入路径替换策略

**选择**: 按文件相对路径替换，如 `import type { DataSchema } from "../types/models.js"`
**替代方案**: server tsconfig paths 映射（如 `@types/*`）— 增加配置复杂度，不值得
**理由**: 相对路径最简单直接，server 内部文件数量可控

### 不保留 barrel 导出

**选择**: 直接从具体文件导入（`from "../types/models.js"`），不通过 `types/index.ts` 中转
**替代方案**: 保留 `types/index.ts` barrel 文件 — 多一层间接，无收益
**理由**: server 内部无需 barrel，直接引用源文件更清晰

## Risks / Trade-offs

- **未来 client 需要共享类型时需要再抽出** → 届时按实际需求抽取，YAGNI 原则
- **import 路径变更导致 git blame 中断** → 可接受，一次性重构
