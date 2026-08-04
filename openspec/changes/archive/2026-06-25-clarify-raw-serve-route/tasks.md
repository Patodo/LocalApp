## 1. RED：锁定入口语义回归

- [x] 1.1 新增或更新 CLI e2e 测试，断言 `localapp upload` / 页面信息命令默认展示正式 Shell URL `/{userId}/{name}`，不得把 `/serve/{userId}/{name}/` 称为应用预览或默认访问地址。
- [x] 1.2 新增文档/skill 静态检查测试，覆盖 `init-repo/CLAUDE.md`、init-repo 内置 skills、`.agents/skills/localapp-app-loop` 和 E2E 指引，要求上传后用户体验验证入口为 `/{userId}/{name}`。
- [x] 1.3 新增 SDK basePath 测试，覆盖正式 Shell route `/{userId}/{name}` + 注入 `/serve/{userId}/{name}/` resource base 时，API basePath 解析为 `/serve/{userId}/{name}/api`。
- [x] 1.4 新增 server/web 路由职责测试，区分正式 Shell route 返回 PlatformShell、raw `/serve` route 仅返回裸应用资源且不含 nav-shell。
- [x] 1.5 运行新增测试并确认失败点来自旧 `/serve` 入口语义残留；完成后提交，commit message 使用中文 Conventional Commits。

## 2. GREEN：更新实现与指导材料

- [x] 2.1 更新 CLI 上传和页面信息输出：默认用户可访问地址使用 `/{userId}/{name}`；如保留 raw URL，字段名或文案必须标注为 internal raw resource/API URL。
- [x] 2.2 更新 `init-repo/CLAUDE.md`、模板 skills 和相关开发指南，将上传后验证路径改为 `/{userId}/{name}`，仅在资源/API 诊断中提及 `/serve`。
- [x] 2.3 更新 `.agents/skills/localapp-app-loop` 的任务信封、用户验证和反馈清单，使平台侧下发给应用侧的默认验证入口为正式 Shell route。
- [x] 2.4 更新 SDK basePath 检测或测试命名，确保正式 Shell 注入 resource base 是第一优先级，raw pathname 仅作为兼容路径。
- [x] 2.5 更新 server/web 测试命名和必要注释，明确 `/serve` 是 raw app resource/API route，`/{userId}/{name}` 是正式用户入口。
- [x] 2.6 运行 RED 阶段新增测试并确认通过；完成后提交，commit message 使用中文 Conventional Commits。

## 3. REFACTOR：收敛命名和边界

- [x] 3.1 检查代码中的 `preview`、`serveUrl`、`pageUrl`、`rawUrl` 等命名，必要时重命名或补充注释，避免把 raw route 暗示为用户入口。
- [x] 3.2 抽取或统一 URL 构造 helper，减少 CLI、server 测试、skill 文档中手写 `/serve` 和正式入口的重复逻辑。
- [x] 3.3 清理过时的 iframe/裸预览表述，保留 native Shell、DevShell、Next dev PlatformShell 预览三者的边界说明。
- [x] 3.4 运行受影响包的格式化、类型检查或最小测试集；完成后提交，commit message 使用中文 Conventional Commits。

## 4. 验证与收口

- [x] 4.1 运行 `openspec status --change "clarify-raw-serve-route"`，确认 tasks 仍可追踪且 delta specs 无结构问题。
- [x] 4.2 运行相关 server/web/sdk/cli 测试，至少覆盖 route、SDK basePath、CLI 输出和文档/skill 静态检查。
- [x] 4.3 如 CLI 输出或 init-repo runtime 发生变化，重新构建 CLI，并记录是否需要下游应用执行 `localapp sync`。
- [x] 4.4 手动或自动验证已上传应用通过 `http://localhost:3000/{userId}/{name}` 打开正式 Shell，确认 `/serve/{userId}/{name}/` 只用于 raw 资源/API 诊断。
- [x] 4.5 更新任务勾选状态，提交最终收口 commit，准备后续 `/opsx-apply` 或归档流程。
