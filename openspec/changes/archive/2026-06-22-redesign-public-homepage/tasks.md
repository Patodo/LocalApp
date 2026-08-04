## 1. 公开首页约束

- [x] 1.1 RED：添加或执行未登录首页检查，确认当前页面仍存在内部 CLI 路径、复制路径按钮或误导性入口
- [x] 1.2 GREEN：重构未登录 `/` 首页，只保留明确登录入口和产品说明
- [x] 1.3 GREEN：移除公开首页中的 `packages/server/static/cli`、复制路径按钮、控制台入口和不明确的“进入平台”CTA
- [x] 1.4 REFACTOR：将公开首页和登录后工作台拆成清晰的子组件，避免状态和文案混杂
- [x] 1.5 验证：未登录访问 `/` 不跳转登录页，且页面不包含禁止项

## 2. 登录后 CLI 获取承接

- [x] 2.1 RED：确认当前登录后用户面板缺少清晰的 CLI 获取/配置说明入口
- [x] 2.2 GREEN：在合适的 `/my/*` 页面增加 CLI 获取说明，包含 API Key、`localapp login` 或 `localapp update` 等可执行下一步
- [x] 2.3 GREEN：确保未登录访问该 `/my/*` 页面仍重定向到登录页
- [x] 2.4 REFACTOR：让 CLI 说明复用现有用户面板风格，不新增外部 UI 依赖

## 3. 视觉与可用性验证

- [x] 3.1 RED：确认当前 Dockerfile 未复制 `packages/server/static/cli`，容器镜像缺少 CLI 下载产物
- [x] 3.2 GREEN：更新 Dockerfile，将 CLI 静态产物目录复制到镜像内 server 可读取的位置
- [x] 3.3 GREEN：明确 Docker 构建前需要先运行 CLI release 发布步骤，确保 `versions.json` 和二进制存在
- [x] 3.4 验证：运行 `pnpm -C packages/web build`
- [x] 3.5 验证：使用浏览器检查桌面宽度下公开首页视觉、链接和禁止项
- [x] 3.6 验证：使用浏览器检查移动宽度下公开首页文本不溢出、不重叠
- [x] 3.7 验证：检查 Docker 构建上下文或镜像内包含 `static/cli/versions.json`
- [x] 3.8 验证：运行 `openspec status --change redesign-public-homepage`
