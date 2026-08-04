## 1. 前置检查与 RED：状态流转服务端测试

- [x] 1.1 确认 `add-business-app-model-guidance` 已完成或当前分支已具备业务元数据、当前用户默认值和记录级权限基础
- [x] 1.2 为 schema 创建接口新增失败测试：可保存并返回 `business.statusField`、`business.initialStatus` 和 `business.transitions`
- [x] 1.3 为 schema 创建接口新增失败测试：transition 名称重复、缺少目标状态、引用不存在状态字段时返回 400
- [x] 1.4 为 transition 查询端点新增失败测试：根据当前状态和权限返回可用 transition 列表
- [x] 1.5 为 transition 执行端点新增失败测试：成功执行时写入目标状态、当前用户字段和当前时间字段
- [x] 1.6 为 transition 执行端点新增失败测试：状态不匹配返回 400、无权限返回 403、不存在 transition 返回 404
- [x] 1.7 运行服务端相关测试，确认新增测试在实现前失败
- [x] 1.8 提交 RED 阶段测试变更

## 2. GREEN：状态流转服务端实现

- [x] 2.1 扩展 schema 和业务元数据类型，支持 `statusField`、`initialStatus` 和 `transitions`
- [x] 2.2 实现 transition 定义校验，覆盖名称唯一、from/to、状态字段和访问策略合法性
- [x] 2.3 新增 transition 解析 helper，封装当前状态匹配、权限判断和服务端 set 字段计算
- [x] 2.4 实现 `GET /serve/{userId}/{name}/api/{resource}/{id}/transitions`
- [x] 2.5 实现 `POST /serve/{userId}/{name}/api/{resource}/{id}/transitions/{transitionName}`
- [x] 2.6 确保 transition 执行复用 CRUD 字段校验和记录级访问控制基础
- [x] 2.7 运行服务端相关测试，确认 RED 阶段测试通过
- [x] 2.8 提交 GREEN 阶段服务端实现

## 3. RED/GREEN：SDK 状态流转 Hook

- [x] 3.1 为 `useTransitions()` 新增失败测试：加载可用 transitions、id 为空时不请求
- [x] 3.2 为 `transition(name, payload?)` 新增失败测试：发送 POST、返回更新后记录、触发 `onSuccess`
- [x] 3.3 为错误处理新增失败测试：400/401/403/404 使用 `LocalAppError`
- [x] 3.4 实现并导出 `useTransitions()` Hook
- [x] 3.5 更新 SDK 文档或模板说明，解释 transition API 与普通 update 的边界
- [x] 3.6 运行 SDK React 测试，确认新增场景通过
- [x] 3.7 提交 SDK 阶段变更

## 4. RED/GREEN：CLI 与 schema 文件输入

- [x] 4.1 为 CLI schema 文件输入新增失败测试：完整 schema 文件可包含 transitions 元数据
- [x] 4.2 更新 CLI schema 创建命令，确保 `--file` 能传递 transitions 元数据
- [x] 4.3 更新类型生成或 schema 查询测试，确认 transitions 元数据不破坏旧输出
- [x] 4.4 运行 CLI 相关测试，确认新增场景通过
- [x] 4.5 提交 CLI 阶段变更

## 5. RED/GREEN：init 模板与 Agent 指引

- [x] 5.1 为 init 模板新增失败测试：`CLAUDE.md` 包含状态流转 skill 入口
- [x] 5.2 为 init 模板新增失败测试：`.claude/skills/` 包含状态流转 skill 文件
- [x] 5.3 为模板示例新增失败测试：示例使用 `useTransitions` 或等价 API，而不是普通 update 修改业务状态
- [x] 5.4 新增状态流转 skill，覆盖申请、审批、工单等应用的 transition 建模规则
- [x] 5.5 更新 `localapp-data` skill，要求业务状态变化优先使用 transition API
- [x] 5.6 更新 `CLAUDE.md` 深入指南入口和核心规则
- [x] 5.7 更新默认业务示例，展示可用 transition 按钮、执行后刷新和错误状态
- [x] 5.8 确认 CLI 内置模板包含新增指引和示例文件
- [x] 5.9 运行 init 模板测试和构建，确认新增场景通过
- [x] 5.10 提交模板与 Agent 指引阶段变更

## 6. REFACTOR：一致性整理

- [x] 6.1 统一服务端、SDK 和文档中的 transition 命名、错误信息和返回结构
- [x] 6.2 检查无 transitions 的旧 schema、旧 CRUD、旧 SDK Hook 和旧模板项目行为保持兼容
- [x] 6.3 评估是否需要禁止普通 update 直接修改 `statusField`，并在文档中记录当前决策
- [x] 6.4 补充必要注释，保持 transition helper 可维护
- [x] 6.5 运行相关 lint、类型检查和单元测试
- [x] 6.6 提交 REFACTOR 阶段变更

## 7. 验证与收尾

- [x] 7.1 运行 `openspec validate add-business-state-transitions --strict`
- [x] 7.2 运行服务端测试，覆盖 schema、CRUD、访问控制和 transition 集成场景
- [x] 7.3 运行 SDK React 测试
- [x] 7.4 运行 init 模板测试与 `npm run build`
- [x] 7.5 运行 CLI 模板和 schema 相关 Rust 测试
- [x] 7.6 使用 builtin 模板初始化临时应用并构建，确认状态流转指引和示例可用
- [x] 7.7 更新 tasks.md 勾选状态并提交最终任务清单
