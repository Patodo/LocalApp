## Why

LocalApp 的目标正在从“托管一个上传的前端页面”演进为“企业内部统一业务应用运行时”，应用需要天然继承平台 nav-shell、用户身份、AI、确认弹窗、下载、路由、主题和后端能力。当前 iframe 模式持续造成 dev/prod shell 漂移、平台能力重复桥接、应用开发者误判线上 UI 边界等问题；趁正式上线前、下游应用仍主要用于平台验证，应一次性切换到 native 默认运行模式。

## What Changes

- **BREAKING**：生产 `/serve/{user}/{app}` 不再用 iframe 嵌入应用，应用 bundle 作为平台 shell 内的 native app mount 运行。
- **BREAKING**：移除 iframe sandbox 作为默认运行路径，平台能力不再依赖跨 iframe `postMessage` 作为主链路。
- 平台 shell 成为应用运行页面的唯一外壳，应用内容挂载在受控 app container 内，左侧应用名称、Issue/AI、右侧用户入口等与线上 shell 保持一致。
- SDK 的 `platform-runtime` 保留为唯一平台能力入口，但 native 模式下直接连接同页 platform host；历史 `postMessage` 仅作为兼容/测试实现，不作为新应用默认路径。
- dev-shell 与生产 platform shell 对齐：dev 模式只在最左侧额外注入 `DEV` 入口，其余 nav-shell、AI、用户入口、确认弹窗、下载等能力与生产共用契约。
- CLI 的 `localapp sync`、`localapp init`、`localapp dev` 同步更新 runtime、vite 插件和 init-repo 模板，保证本地开发和生产 native 模式一致。
- init-repo 模板、skills、文档和测试样例更新为 native runtime 约束：应用通过 SDK 调平台能力，不直接依赖 iframe、`window.parent` 或 sandbox 特性。
- 明确 native 风险治理边界：应用不能覆盖平台 shell，平台认证入口唯一，应用样式受 app container 范围约束，平台 API 继续做后端权限校验与审计。

## Capabilities

### New Capabilities
- `native-app-runtime`: 定义 LocalApp 应用以 native 方式挂载到平台 shell 内运行的行为、能力契约和安全边界。

### Modified Capabilities
- `platform-shell`: 平台 shell 从 iframe 父壳改为 native 应用宿主，并继续提供 nav、AI、用户态、确认、下载等平台能力。
- `page-serving`: `/serve/{userId}/{name}` 的页面服务模式改为渲染平台 shell + native app mount，不再默认输出 iframe 容器。
- `sdk-agent`: `platform-runtime` 需要支持同页 native host，并保持应用侧 API 不感知运行模式。
- `dev-shell-injection`: dev-shell 的注入模型改为生产 nav-shell 派生，只额外注入最左侧 `DEV` 入口。
- `cli-dev-server`: `localapp dev` 生成和启动的 runtime 必须支持 native dev shell、mini-server 分流和同页平台能力 host。
- `runtime-zone-sync`: CLI sync 必须同步 native runtime 文件、vite 插件、样式和版本标记。
- `cli-builtin-template`: CLI 内置 init-repo 模板必须生成 native runtime 兼容项目。
- `init-template`: 模板文档、skills、示例代码必须避免 iframe/sandbox 假设，并推荐 SDK 平台能力入口。
- `content-upload`: 上传产物和 manifest 处理需要支持 native app bundle 被平台 shell 挂载运行。

## Impact

- `packages/web/components/shell/*`：platform shell、navbar、AI sidebar、确认弹窗、应用 mount 容器。
- `packages/server/src/routes/serve.ts` 与相关集成测试：生产 serve HTML/静态资源/API 路由。
- `packages/sdk-agent/src/platform-runtime.ts` 与 postMessage 类型：native host 适配、能力响应、兼容边界。
- `init-repo/runtime/*`：dev-shell、vite-plugin、mini-server、runtime 样式和测试。
- `packages/cli`：init/sync/dev 打包 runtime、模板 staging、版本生成和 CLI 测试。
- `init-repo`：模板源码、skills、文档、测试和示例平台能力调用。
- 现有 iframe 相关测试、文档和实现需要删除或改写；所有新测试应覆盖 native 生产路径与 dev 路径一致性。
