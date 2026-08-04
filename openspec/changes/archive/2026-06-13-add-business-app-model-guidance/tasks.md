## 1. RED：服务端业务模型与记录级权限测试

- [x] 1.1 为 schema 创建接口新增失败测试：可保存并返回 `business` 元数据
- [x] 1.2 为 schema 字段约束新增失败测试：`defaultFrom: "currentUser.id"` 和 `defaultFrom: "currentUser.name"` 可被接受
- [x] 1.3 为 schema 字段约束新增失败测试：`enum` 合法值通过、非法值返回 400
- [x] 1.4 为 CRUD 创建接口新增失败测试：当前用户字段由服务端填充且覆盖请求体伪造值
- [x] 1.5 为 CRUD 列表接口新增失败测试：记录级 read 策略只返回当前用户有权读取的记录
- [x] 1.6 为 CRUD 更新/删除接口新增失败测试：记录级字段匹配和状态条件不满足时返回 403
- [x] 1.7 运行服务端相关测试，确认新增测试在实现前失败
- [x] 1.8 提交 RED 阶段测试变更

## 2. GREEN：服务端业务模型与记录级权限实现

- [x] 2.1 扩展共享类型和服务端类型，支持 `business`、`defaultFrom`、`enum` 和记录级访问策略
- [x] 2.2 更新 schema 创建、更新和查询接口，保存并返回业务模型元数据和扩展字段约束
- [x] 2.3 更新 SQLite 建表和字段校验逻辑，支持枚举约束的创建与更新校验
- [x] 2.4 实现当前用户默认值填充，未登录且需要当前用户默认值时返回 401
- [x] 2.5 新增记录级访问控制 helper，统一处理字段匹配、状态条件和页面所有者例外
- [x] 2.6 在 CRUD list/get/update/delete/create 路径中接入记录级访问控制
- [x] 2.7 运行服务端相关测试，确认 RED 阶段测试通过
- [x] 2.8 提交 GREEN 阶段服务端实现

## 3. RED/GREEN：CLI 与 schema 文件输入体验

- [x] 3.1 为 CLI schema 创建命令新增失败测试：`--file` 可包含 fields、business 和 routeAccess 扩展结构
- [x] 3.2 更新 CLI schema 创建命令，使文件输入支持完整 schema 请求体，同时保持旧 `--fields` 用法兼容
- [x] 3.3 更新 CLI schema 类型生成测试，确认 `enum` 和 `defaultFrom` 不破坏 TypeScript 类型生成
- [x] 3.4 运行 CLI 相关测试，确认新增场景通过
- [x] 3.5 提交 CLI 阶段变更

## 4. RED/GREEN：React SDK 权限 API

- [x] 4.1 为 `usePermissions()` 新增失败测试：基于当前用户、schema 和记录返回正确 `can()` 结果
- [x] 4.2 为 `<Can>` 新增失败测试：有权限时渲染 children，无权限时隐藏 children
- [x] 4.3 实现权限策略解析工具，复用服务端记录级策略语义中可在前端判断的部分
- [x] 4.4 实现并导出 `usePermissions()` Hook
- [x] 4.5 实现并导出 `<Can>` 组件
- [x] 4.6 更新 SDK 文档或模板说明，明确权限 API 仅用于 UI 判断，后端才是安全边界
- [x] 4.7 运行 SDK React 测试，确认新增场景通过
- [x] 4.8 提交 SDK 阶段变更

## 5. RED/GREEN：init 模板与 Agent 指引

- [x] 5.1 为 init 模板新增失败测试：`CLAUDE.md` 包含业务建模指引入口
- [x] 5.2 为 init 模板新增失败测试：`.claude/skills/` 包含业务建模 skill 文件
- [x] 5.3 为默认示例新增失败测试：示例包含业务字段、当前用户归属和权限 UI 模式
- [x] 5.4 新增业务应用建模 skill，覆盖申请类、审批类、分配类、目录类模型约定
- [x] 5.5 更新 `localapp-data` skill，加入 schema、所有权、状态和记录级权限规则
- [x] 5.6 更新 `CLAUDE.md`，把业务建模放入核心规则和深入指南入口
- [x] 5.7 更新默认 `App.tsx`，展示 shadcn、业务字段、SDK CRUD 和权限 UI 的组合模式
- [x] 5.8 确认 CLI 内置模板包含新增指引与示例文件
- [x] 5.9 运行 init 模板测试和构建，确认新增场景通过
- [x] 5.10 提交模板与 Agent 指引阶段变更

## 6. REFACTOR：一致性整理

- [x] 6.1 统一服务端和 SDK 对记录级策略的命名、类型和错误信息
- [x] 6.2 检查旧 schema、旧 CRUD、旧 SDK Hook、旧模板项目的向后兼容行为
- [x] 6.3 补充必要注释，避免业务策略解析逻辑难以维护
- [x] 6.4 运行相关 lint、类型检查和单元测试
- [x] 6.5 提交 REFACTOR 阶段变更

## 7. 验证与收尾

- [x] 7.1 运行 `openspec validate add-business-app-model-guidance --strict`
- [x] 7.2 运行服务端测试，覆盖 schema、CRUD、访问控制和集成场景
- [x] 7.3 运行 SDK React 测试
- [x] 7.4 运行 init 模板测试与 `npm run build`
- [x] 7.5 运行 CLI 模板相关 Rust 测试
- [x] 7.6 使用 builtin 模板初始化临时应用并构建，确认业务建模指引和示例可用
- [x] 7.7 更新 tasks.md 勾选状态并提交最终任务清单
