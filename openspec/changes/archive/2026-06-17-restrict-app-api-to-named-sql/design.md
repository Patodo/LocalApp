## Context

`/serve/{user}/{app}/api/*` 当前由 `matchAppApiRoute`（`packages/server-core/src/lib/app-api-contract.ts`）路由到 6 类处理分支：平台辅助、内容、named SQL、REST CRUD、transitions、raw SQL / legacy upload。其中 REST CRUD 和 transitions 是**隐式自动暴露**的——只要 schema 声明了一个 resource，6 个 REST 端点和 N 个 transition 端点就自动出现，无需任何额外声明。

SDK `packages/sdk-core/src/client.ts` 在 `list/get/create/update/delete/count` 六个 helper 里采用"先试 named SQL、404 则 fallback 到 REST"的双协议策略，由 `shouldFallbackCount` / `shouldFallbackNamed` 判定是否回退。

下游应用反馈证实双协议是脆弱的：
- named SQL 严格校验 params（`Unknown param` → 400），REST 按 schema 字段宽松匹配——同一操作走两条路径行为不一致
- 作者删除某个 named SQL 后，SDK 静默 fallback 到 REST，作者以为关闭的口子仍然开放
- 浏览器 console 每次操作出现 404 噪音，掩盖真实错误

平台当前状态：未上线、单用户（作者本人）、`init-repo` 模板可任意修改、未来应用开发将迁移到 web 工作台由平台 agent 编写。本次改造的破坏性变更不会影响外部用户。

## Goals / Non-Goals

**Goals:**
- 应用层 `/serve/{user}/{app}/api/*` 的数据读写通道**唯一**化为 named SQL（`/queries/$<name>` + `/mutations/$<name>`）
- SDK helper（list/get/create/update/delete/count）保留为 named SQL 语法糖，但**移除 REST fallback**——未声明对应 named SQL 时直接报错
- transitions 概念从"服务端执行的端点"降级为"前端 SDK 本地计算的元数据"——`business.transitions` 仍可声明，但服务端不据此暴露任何 HTTP 入口
- 平台表面（`/time`、`/me`、`/users`、`/groups[/:id]`、`/platform/*`、`/_schemas`、`/content/upload`、`/content/:key`）保留，作为非资源 CRUD 的基础设施
- 生产 server 与 dev mini-server 行为对齐，删除两边的 REST CRUD / transitions 实现
- `init-repo` 的 work_items 示例补齐完整 named SQL，作为新应用模板的标准形态

**Non-Goals:**
- 不修改 named SQL 自身的执行引擎（params 绑定、SQL 安全校验、access 校验等）
- 不引入"从 schema 自动生成 named SQL"的脚手架——平台未来由 agent 编写应用，agent 本身就是生成器
- 不修改 SQLite 长连接管理、版本管理、文件上传等基础设施
- 不修改 access-control 的策略模型（recordAccess / routeAccess 概念保留，但应用方式从"REST 中间件"变为"named SQL 的 access 字段"）
- 不为已删除的 REST 端点提供兼容期/feature flag——破坏性变更一次性完成
- 不动 OpenSpec 已声明的 `crud-api` 中的 SQLite 存储与 schema 推断部分（这些仍是 named SQL 执行器的基础设施）

## Decisions

### Decision 1: SDK helper 保留，删除 fallback（A 方案）

**选择**：`client.create('work_items', data)` 这类 helper 保留作为语法糖，内部仅调 `mutate('$work_items.create', data)`。`shouldFallbackCount` / `shouldFallbackNamed` 工具函数及所有 catch 分支的 fallback 逻辑全部删除。

**为什么不是 B（砍掉 helper，只留 query/mutate）**：
- 应用代码可读性：`client.create('work_items', {...})` 比 `client.mutate('$work_items.create', {...})` 更直观，未来 agent 写代码也更不容易拼错命名
- 抽象层次：resource + action 的两段式命名比单字符串更结构化
- 破坏面更小：现有应用代码不需要全量改写

**为什么不是 C（保留 fallback 但加 warning）**：
- fallback 是双协议的根本来源，warning 治标不治本
- 真实场景里 console warning 会被忽略，问题仍会发生

### Decision 2: transitions 元数据保留但服务端不执行（Y 方案）

**选择**：删除 `/api/<resource>/:id/transitions` 和 `/api/<resource>/:id/transitions/:name` 端点；删除 `serve.ts` 中 `transition-list` / `transition-execute` 处理逻辑。`business.transitions` 仍可在 schema 中声明，**仅作为前端 SDK 计算可用动作的元数据**。

SDK 新增纯函数 `availableTransitions(resource, record)`：
- 输入：schema 的 `business.transitions` 声明 + 当前 record
- 输出：当前状态下可执行的 transition 名字及 label
- 实现：根据 `statusField` 取 record 当前状态，过滤 `from` 包含该状态的 transitions，再按 `access` 策略过滤当前用户

状态流转的实际执行改由应用自己声明对应的 named mutation，例如：
```json
{
  "$work_items.approve": {
    "access": "manager",
    "params": { "id": "number" },
    "sql": "UPDATE work_items SET status='approved', approved_at=:now, approved_by=:currentUser.id WHERE id=:id AND status='pending'"
  }
}
```

**为什么不是 X（保留 transitions 作为平台 abstraction）**：
- agent 未来里"双 abstraction"不再是负担（prompt 可解歧义），但 platform-enforced correctness 的价值在 agent 写应用时确实放大了
- 然而：本次变更目标是**收缩 API 表面**，不是重新设计 transition abstraction。引入 X'（带 hooks 的 transitions）会让本次 commit 同时承担两件事，违反"一次只做一件事"
- transitions 元数据保留意味着未来要加回 X' 时仍可无缝升级——保留升级路径，但当下不做
- Y 的纯粹性与本次"全部走 named SQL"的整体方向一致

**风险接受**：transitions 不再有服务端 FSM 强制校验。状态机的正确性由应用作者（未来是 agent）在 SQL WHERE 子句里自行保证。平台校验层退化为 named SQL 的 access 字段 + SQL 安全检查。

### Decision 3: 平台基础设施端点保留

**选择**：以下端点保留不动——它们不属于资源 CRUD，是平台运行的基础设施：

| 端点 | 用途 |
|------|------|
| `GET /api/time` | 服务器时间（用于 `defaultFrom: "now"` 等） |
| `GET /api/me` | 当前用户信息 |
| `GET /api/users` | 平台用户列表 |
| `GET /api/groups` / `GET /api/groups/:id` | 平台群组 |
| `GET /api/platform/*` | 平台元数据（version/roles 等） |
| `GET /api/_schemas` | 应用 schema 自省 |
| `POST /api/content/upload` | 文件上传 |
| `GET /api/content/:key` | 文件读取 |

**理由**：这些端点不读写应用业务数据，不存在"双协议"问题；SDK 多个 hook 直接依赖（useMe / useUsers / useGroups 等）；删了 SDK 自身就跑不起来。

### Decision 4: 一次到位，不留兼容期

**选择**：所有 REST CRUD、transitions、raw SQL、legacy upload 端点本次 commit 一次性删除，不提供 manifest flag、不提供 feature gate、不提供 deprecation period。

**理由**：
- 平台未上线、外部用户为零——兼容期的成本无人受益
- 兼容期意味着两套逻辑同时存在，维护成本翻倍，且容易把"临时兼容"变成"永久技术债"
- `init-repo` 是新应用的起点，本次同步更新即可避免模板带病
- 作者本人在用的真实应用可同步迁移（与平台改造同一 PR 完成）

### Decision 5: app-db.ts 中 REST 专用辅助函数一并清理

**选择**：`selectAll` / `selectById` / `insertRow` / `updateRow` / `deleteRow` / `countRows` 这些当前仅被 REST CRUD 使用的辅助函数，本次确认无其它调用方后**全部删除**。

**为什么不是保留**：
- 这些函数封装的是"REST 风格的 row 操作"，与 named SQL 执行路径无关
- 保留意味着未来有人会重新接出 REST 端点——刻意删除是"防回退"信号
- named SQL 通过 `execRawSql` 直接执行，不需要 row-level helper

**例外**：`getDbPath` / `getConnection` / `execRawSql` / `loadBackendContract` / `executeNamedSql` 等 named SQL 执行器依赖的函数保留。

### Decision 6: CLI 校验逻辑同步简化

**选择**：`packages/cli/src/commands/db.rs` 和 `upload.rs` 中的契约校验逻辑，删除"resource 自动暴露 REST"相关的字段集合推断（如 `validate_backend_schema_matches_db` 中为 REST 准备的 schema 字段校验），只保留 named SQL 声明的 param / SQL 引用校验。

**理由**：CLI 校验的目的是"上传前阻止契约错误"。REST 路径删除后，对应的预校验也无意义。

### Decision 7: init-repo work_items 模板补齐 6 个 named SQL

**选择**：`init-repo/backend/resources/work_items/queries.json` 和 `mutations.json` 补齐：
- `$work_items.list`（query，支持 offset/limit/sort/order/filters）
- `$work_items.get`（query，按 id）
- `$work_items.count`（query，支持 filters）
- `$work_items.create`（mutation，覆盖所有业务字段）
- `$work_items.update`（mutation，按 id 部分更新）
- `$work_items.delete`（mutation，按 id）

**理由**：模板是新应用的起点，必须展示"完整 named SQL 是常态"的标准形态。下游反馈中提到的 `$work_items.update` 删除是临时修复，模板里要恢复并提供正确的部分更新实现（用 COALESCE 或动态 SQL）。

## Risks / Trade-offs

### [Risk] 应用作者忘记在 SQL WHERE 中加状态守卫 → 非法状态流转

**Mitigation**:
- `init-repo` 模板的 work_items 示例展示正确的 WHERE 守卫写法（如 `WHERE id=:id AND status='pending'`）
- 平台 agent 的系统提示词中包含"状态流转 mutation 必须在 WHERE 中校验当前状态"的指引
- `business.transitions` 元数据保留，前端可用 transition 计算仍正确——只要 UI 根据 `availableTransitions` 显示按钮，非法流转在 UI 层就被挡住（虽然不是服务端强制）

### [Risk] 现有真实应用迁移成本

**Mitigation**:
- 唯一真实应用（作者的）在本次 PR 中同步迁移
- 迁移工作主要是补齐 named SQL 声明，模板可参照
- 由于 named SQL 此前已可用，迁移主要是"补齐缺失声明"而非"重写"

### [Risk] SDK API surface 收缩导致旧版前端代码报错

**Mitigation**:
- SDK `client.exec` 方法删除（raw SQL 入口）——所有调用方需迁移到 `mutate` / `query`
- `client.listTransitions` / `client.executeTransition` 删除——改用 `availableTransitions` + `mutate`
- 在 SDK 升级文档中明确列出 API 变更
- 由于应用代码也在本次改造中同步更新，不会留下断链

### [Risk] 名为 `$<resource>.<action>` 的隐式约定被破坏

**背景**：SDK helper 通过 `$<resource>.<action>` 命名约定定位 named SQL（如 `client.create('work_items', ...)` → `$work_items.create`）。本次改造强化了这个约定（fallback 没了，约定就成了硬性要求）。

**Mitigation**:
- 这个约定原本就存在，本次只是从"软约定"升级为"硬要求"
- 服务端不做命名强制——named SQL 可以叫任何名字，只是 SDK helper 找不到时不 fallback 而已
- 应用作者可以直接用 `client.query('$any_name', params)` / `client.mutate('$any_name', params)` 访问任意命名的 SQL

### [Trade-off] transitions 元数据 vs 实际 SQL 可能脱节

`business.transitions` 声明 pending → approved，但作者写的 `$work_items.approve` SQL 可能 WHERE 子句没限制 status='pending'。前端 UI 会显示"通过"按钮（因为 metadata 说可以），但 SQL 实际可能允许从任何状态转 approved。

**接受理由**：这是 Y 方案的固有代价。平台不再做 FSM 强制，正确性责任转移给作者/agent。未来的 X' 方案（带 hooks 的 transitions）可以重新引入强制，但不在本次范围。

### [Trade-off] 非开发者用户 review 应用代码时看不懂 SQL

未来 web 工作台面向的用户群包含非开发者。SQL 不如 JSON 声明易读。

**接受理由**：
- 本次改造的目标是收缩 API 表面，不是降低应用声明的门槛
- 工作台 UI 可以在 SQL 编辑器层做可视化校验和提示，弥补可读性
- 长期看若需要声明式 abstraction，可以以 X' 形式加回——保留升级路径
- 平台 agent 是主要的应用编写者，agent 写 SQL 不存在人类可读性问题

## Migration Plan

由于破坏性变更一次性完成且无外部用户，迁移按以下顺序在单 PR 内完成：

1. **Server 端先收缩**：
   - `matchAppApiRoute` 删除 crud-* / transition-* / db-exec / legacy-upload 路由匹配
   - `handleCrudRequest` 删除对应处理分支
   - `app-db.ts` 清理 REST 专用辅助函数
   - 同步更新 server-core contract 校验

2. **SDK 同步**：
   - 删除 `shouldFallbackCount` / `shouldFallbackNamed`
   - helper 内部只调 named SQL，未声明直接抛错
   - 新增 `availableTransitions` 纯函数
   - 删除 `exec` 方法及相关 hook

3. **mini-server 对齐**：
   - 删除 REST CRUD 与 transitions 路由
   - 与生产 server 共享 contract 校验路径

4. **CLI 校验更新**：
   - 删除"REST 自动暴露字段集合"相关校验
   - 保留 named SQL 声明校验

5. **init-repo 模板补齐**：
   - `work_items` 的 queries.json / mutations.json 补齐 6 条 named SQL
   - 删除任何"依赖 REST fallback"的文档/skill 引用

6. **真实应用迁移**：
   - 作者本地真实应用同步补齐 named SQL 声明
   - 与平台改造同 PR 提交

7. **测试同步**：
   - 删除 REST CRUD 端点测试
   - 删除 SDK fallback 行为测试
   - 新增 `availableTransitions` 单元测试
   - 新增 named SQL 缺失时 helper 抛错的测试

**回滚策略**：本次为单分支破坏性变更，若发现问题直接 `git revert` 整个 merge commit。无数据迁移、无配置变更，回滚成本等于一次 revert。

## Open Questions

无。三个关键决策（①=A、②=Y、③=P）已在 explore 阶段敲定，本 design 落实这三个决策。实施过程中若发现遗漏的端点或调用方，按"同步删除"原则处理，无需重新讨论。
