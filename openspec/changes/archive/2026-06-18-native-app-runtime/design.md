## Context

当前生产环境通过 `PlatformShell` 渲染顶部平台导航栏，再用 iframe 加载 `/serve/{userId}/{name}/` 中的应用静态产物。开发环境通过 `vite-plugin` 注入 `DevShell` 包裹 `<App />`，因此 dev 本质上已经是同页运行，而 production 仍是 iframe 运行。两条路径导致 shell UI、AI、下载、确认弹窗、剪贴板、路由和平台能力需要在 iframe 边界两侧重复维护。

LocalApp 的部署目标进一步明确为企业内部平台：开发者和使用者均为实名员工，未来还会提供在线 Agent 构建页面的能力，开发者不一定接触 CLI 或代码。基于这个产品方向，默认 iframe 隔离不再是主收益，反而妨碍平台将应用作为一等业务页面运行。

## Goals / Non-Goals

**Goals:**
- 生产应用改为 native mount：平台 shell 和应用运行在同一页面上下文中。
- dev-shell 与生产 shell 使用同一套平台能力契约，dev 只额外提供最左侧 `DEV` 入口和开发工具。
- SDK 保持统一应用侧 API，应用不需要知道自己处于 dev/production 或 native/sandbox。
- CLI 的 init、sync、dev、内置模板和 runtime staging 全部同步 native 模式。
- 移除默认 iframe/sandbox 运行路径及其测试假设。
- 保留后端权限边界：Named SQL、平台 API、上传、用户态仍由服务端校验。

**Non-Goals:**
- 本变更不实现可选 sandbox 模式。决策是上线前一刀切 native，不保留管理员开关。
- 本变更不引入在线 Agent 构建器，只为未来该形态提供运行时基础。
- 本变更不放宽后端访问权限，不允许应用绕过 Named SQL 或平台 API 直接访问平台数据库。
- 本变更不解决第三方不可信应用市场问题。

## Decisions

### 1. 生产 `/serve/{userId}/{name}` 改为 native shell route

生产 shell SHALL 直接渲染平台 nav-shell 和应用 mount 容器。应用的 `index.html` 不再作为顶层 document 注入 iframe，而是作为构建产物元数据来源；实际 JS/CSS 资源由平台 shell 按最新版本产物加载到受控 app container。

理由：这让平台 nav-shell、AI 侧栏、确认弹窗、toast、下载、用户入口、路由和主题成为同一页面中的一等能力，不再需要 iframe 父子窗口协调。

替代方案：继续 iframe 并补更多 bridge。该方案能保留隔离，但每新增一个平台能力都要跨窗口桥接，且 dev/prod 更难一致。

### 2. 平台能力层保留，但主实现变为同页 host

应用仍通过 `@localapp/sdk-agent/platform-runtime` 调用 `confirm`、`downloadFile`、`copyText`、`openRoute`、`getCurrentUser`、`getServerTime`、`ai.*`。native 模式下 SDK 请求同页 platform host；不再依赖 `window.parent.postMessage` 作为主通道。

理由：能力层不是 iframe 补丁，而是平台产品 API。它用于统一体验、权限、审计和未来运行模式扩展。

替代方案：native 下允许应用直接调用 shell 内部函数。该方案耦合太强，容易让应用依赖平台 DOM 和内部实现。

### 3. 应用 mount 容器是唯一可控区域

native 应用 SHALL 挂载在平台 shell 的 app container 内。平台 nav-shell、认证入口、AI shell、确认弹窗等区域不属于应用 DOM 所有权。实现上需要通过 DOM 结构、样式层级和构建检查减少应用覆盖 shell 的可能。

理由：native 增强体验的同时会放大前端仿冒和全局污染风险，必须定义清晰的 UI 所有权边界。

替代方案：完全信任应用任意控制 DOM。该方案短期简单，但会放大登录仿冒、shell 覆盖和全局样式污染。

### 4. dev-shell 派生自 production shell

开发模式不再维护一套独立外观。Dev shell SHALL 复用 production nav-shell 的布局、用户入口、AI 和平台能力处理，仅在最左侧注入 `DEV` 按钮，下拉包含工具和开发工具。dev context 中的身份/时间切换仍通过 mini-server 的 `/api/dev/*` 实现。

理由：开发者看到的顶部 shell 必须接近发布后 UI，避免下游重复实现应用内导航。

替代方案：继续维护模拟 dev-shell。此前已经多次出现 CSS、用户态、AI、能力响应漂移。

### 5. CLI/runtime 同步是交付边界的一部分

`localapp sync`、`localapp init` 和 `localapp dev` 必须把 native runtime、vite 插件、dev-shell、SDK 源码、样式 preset 和版本标记同步到应用项目。构建 debug CLI 后，下游通过 sync 即可获得 native 模式。

理由：目前下游应用是平台验证载体，CLI 和 init-repo 不同步会造成“平台已改、项目仍旧 runtime”的假失败。

替代方案：只改 server/web。该方案会让本地开发和生产继续分裂。

## Risks / Trade-offs

- **Native 放大伪造平台 UI 风险** → 平台认证入口唯一；应用不得覆盖 shell；测试扫描应用模板和 runtime 中的危险全局覆盖；未来在线构建器可加入发布扫描。
- **应用 CSS 污染 shell** → shell 和 app container 建立明确层级；init-repo 默认样式避免全局选择器；测试覆盖 shell 未被应用样式覆盖。
- **应用 JS 影响全局 API** → 平台能力通过 SDK 暴露；文档禁止应用依赖 shell DOM、`window.parent` 和内部状态；关键后端 API 继续权限校验。
- **直接加载应用产物比 iframe 复杂** → 先支持 Vite 标准产物：解析最新版本 `index.html` 中的 module script 和 stylesheet，服务端生成 shell HTML/Next shell 时加载对应资源。
- **历史 iframe 测试大量失效** → 作为 breaking change 统一改写，删除 iframe wrapper 断言，改为 native shell/app mount 断言。
- **老应用可能依赖 iframe 行为** → 正式上线前没有兼容承诺；要求通过 `localapp sync` 更新 runtime 并按 SDK 能力契约运行。

## Migration Plan

1. 增加失败测试：生产页面不得包含 iframe，必须包含 native app mount；dev shell 必须派生 production nav；SDK native host 请求必须成功。
2. 改造 production shell：移除 iframe 渲染，改为 native app mount 和资源加载。
3. 改造 SDK/platform runtime：同页 host 为主，保留测试级 postMessage 类型但不作为默认路径。
4. 改造 dev-shell/vite-plugin：DEV 仅作为 nav-shell 注入项，应用同页运行。
5. 更新 CLI staging、sync、init 和 runtime version。
6. 更新 init-repo 模板、skills 和文档，删除 iframe/sandbox 指南。
7. 跑 server/web/init-repo/sdk-agent/cli 相关测试，构建 debug CLI。
8. 用 `sample-app` 执行 `localapp sync`、`localapp dev` 和生产上传验证。

Rollback 策略：本变更发生在正式上线前，不提供运行时双模式回滚。若 native 实施阻塞，回滚整个分支到变更前版本，而不是保留半套 iframe 兼容层。

## Open Questions

- 生产 shell 加载 Vite 资源时是否由 Next route 解析 `index.html`，还是在 Fastify serve 层生成 shell HTML；实施时应选择现有平台 shell 所属边界最小的方案。
- native app mount 是否需要首期实现 CSS 选择器静态扫描，还是先以 init-repo 约束和 shell 层级测试覆盖。
- 旧的 `/serve/{userId}/{name}/` 静态资源路径在 native 后是否继续保留为资源服务 API，还是改为仅用于 assets。
