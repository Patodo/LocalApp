## Context

当前 LocalApp SDK 存在四个影响开发者体验的问题：

1. **模板依赖解析失败**：`init-repo/package.json` 使用 pnpm 专有协议 `workspace:*` 引用 SDK 包。CLI（Rust）提取模板后执行 `npm install`，npm 不识别此协议导致 init 全流程中断。SDK 包未发布到 npm registry，仅存在于 monorepo workspace 中。
2. **useExec 功能缺失**：`raw-sql-endpoint` spec 明确规定 CRUD 模式拒绝 exec 请求（返回 404），但 `localapp-data.md` 文档承诺 CRUD 模式下可用。两个 Agent 均因此无法执行聚合查询。
3. **useList 依赖不稳定**：`use-list.ts` 将 `JSON.stringify(options)` 作为 `useCallback`/`useEffect` 依赖，每次渲染生成新字符串引用，可能在某些场景触发多余请求。
4. **模板测试失败**：双 React 实例问题导致 vitest 运行失败。
5. **Mutation 无回调**：`useCreate`/`useUpdate`/`useDelete` 无法在操作成功后执行自定义逻辑（如刷新列表）。

## Goals / Non-Goals

**Goals:**
- `localapp init` 生成的项目可直接 `npm install` 成功
- CRUD 模式下 `useExec` 可用（受 sqlAccess 权限控制）
- 修复模板测试使其全绿
- Mutation hooks 支持 onSuccess 回调
- useList 依赖引用稳定化

**Non-Goals:**
- 不引入 SWR/React Query 等外部缓存库（推迟到迭代 2）
- 不实现跨组件自动缓存失效（仅提供 onSuccess 回调作为最小化方案）
- 不修改 SDK 包的发布流程（仍使用 workspace 内部引用）

## Decisions

### Decision 1: vendor/ 目录方案解决 workspace:*

**选择**：CLI 提取模板后，将三个 SDK 包源码拷贝到 `vendor/{sdk-core, sdk-react, sdk-agent}/` 目录，后处理 `package.json` 将 `workspace:*` 替换为 `file:./vendor/{pkg}`。

**替代方案**：
- A) 切换到 pnpm install：需用户安装 pnpm，增加外部依赖
- B) 发布 SDK 到 npm：需要完整的发布流程，当前阶段过早
- C) 直接将 SDK 代码内联到模板 src/ 中：破坏包结构，import 路径需全部改动

**理由**：SDK 包是纯 TypeScript 源码（无构建步骤），`"main": "./src/index.ts"` 可被 Vite 直接消费。`file:` 协议被 npm/pnpm/yarn 通用支持。保留 `@localapp/sdk-react` 等包名导入不变。

**实现要点**：
- CLI 已用 `include_dir!` 嵌入 init-repo，需额外嵌入 `packages/sdk-{core,react,agent}/` 目录
- 后处理逻辑：读取 `package.json`，正则替换 `"workspace:*"` 为 `"file:./vendor/{pkg-name}"`
- vendor 目录在 `include_dir!` 的排除列表外
- 需在 `template.rs` 中新增 `extract_sdk_packages` 函数
- SDK 包自身的 `package.json` 中若有 `workspace:*` peerDependencies，也需清理

### Decision 2: CRUD 模式开放 useExec

**选择**：移除 `serve.ts:238` 的 `mode !== "sql"` 检查，仅保留 `sqlAccess` 权限校验（默认 `owner`）。添加 CRUD 管理表的 DROP TABLE 防护。

**替代方案**：
- A) 仅修改文档：与 Agent 实际需求矛盾（聚合查询是刚需）
- B) 新增独立聚合端点：过度设计

**理由**：sqlAccess 默认值为 `owner`，只有页面所有者可执行 raw SQL。CRUD 模式下用户已在管理自己的表，允许查询（SELECT/聚合）无安全风险。写操作（INSERT/UPDATE/DELETE）也由 owner 控制是合理的。

**DROP TABLE 防护**：在 `execRawSql` 中检测 `DROP TABLE` 语句，若目标表名出现在 `_schemas` 中则拒绝执行，防止误删 CRUD 管理的表。

### Decision 3: useList 依赖稳定化

**选择**：使用 `useMemo` 序列化 options，避免 `JSON.stringify` 直接作为依赖。

```typescript
const optionsKey = useMemo(() => JSON.stringify(options ?? {}), [options]);
```

在 `useCallback` 和 `useEffect` 中使用 `optionsKey` 替代 `JSON.stringify(options)`。

### Decision 4: vitest resolve.alias 修复双 React

**选择**：在 init-repo 的 vitest 配置中添加 `resolve.alias`，将所有 React 导入指向模板自有的 `node_modules/react`。

**替代方案**：在 SDK 包中声明 React 为 peerDependency 并由模板提供 — 已是现状，但因 workspace 符号链接导致双实例。alias 更直接。

### Decision 5: Mutation hooks onSuccess 回调

**选择**：为 `useCreate`/`useUpdate`/`useDelete` 添加可选的 `onSuccess` 选项参数。

```typescript
const { create } = useCreate<T>("todos", { onSuccess: (data) => { refresh(); } });
```

**不使用 EventEmitter/Context 的理由**：
- 模块级 EventEmitter 存在内存泄漏风险（cleanup 不可靠）
- React Context 需要用户包裹 Provider，增加集成成本
- onSuccess 回调覆盖 80% 用例（手动刷新关联列表），实现零侵入

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| vendor/ 方案增加 CLI 二进制体积 | SDK 源码总计约 20KB，影响极小 |
| CRUD 模式下 raw SQL 绕过 routeAccess | sqlAccess 默认 owner，文档明确说明此限制 |
| DROP TABLE 防护可能被 `DROP TABLE IF EXISTS` 等变体绕过 | 正则匹配 `DROP\s+TABLE` 并提取表名，覆盖常见变体 |
| onSuccess 回调不如自动失效方便 | 记录为迭代 2 待办，届时考虑 React Context 方案 |
| `file:` 引用在 Windows 上可能有路径分隔符问题 | 使用 Rust 的 `Path` API 构建路径，确保跨平台 |
