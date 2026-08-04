## 1. 环境搭建优化（dev-quickstart）

- [x] 1.1 在根 `package.json` 的 scripts 中增加 `"dev": "pnpm -C packages/server dev"`
- [x] 1.2 创建 `.env.example`，包含 DATA_DIR、JWT_SECRET、BOOTSTRAP_API_KEY 示例值，TEMPLATE_REPO_URL 以注释呈现
- [x] 1.3 修正主项目 `CLAUDE.md:7`，将 `npm run dev` 改为 `npm run dev:server`（两种写法并存，以 script 名为准）
- [x] 1.4 验证：执行 `npm run dev` → server 正常启动，不再报 "Missing script"

## 2. Server 配置项降级（server-config）

- [x] 2.1 修改 `packages/server/src/lib/config.ts`，删除 TEMPLATE_REPO_URL 的硬校验（`if (!config.templateRepoUrl) throw`）
- [x] 2.2 更新 `packages/server/src/plugins/storage.ts`（或模板下载路由），在远程模板克隆时按需校验 TEMPLATE_REPO_URL，未配置时返回 HTTP 400 和明确错误信息
- [x] 2.3 运行 server 侧现有测试，确保不引入回归
- [x] 2.4 验证：不设置 TEMPLATE_REPO_URL 启动 server → 正常启动，`GET /api/config` 返回 templateRepoUrl 为空字符串

## 3. CLI 增强（cli-tool）

- [x] 3.1 在 `packages/cli/src/main.rs` 的 `builtin_repo` 字段上增加 `#[arg(alias = "builtin_repo")]`
- [x] 3.2 修改 `packages/cli/src/commands/schemas.rs`，为 `create` 子命令增加 `--file <path>` 参数（与 `--fields` 互斥）
- [x] 3.3 实现 `--file` 的文件读取和 JSON 解析逻辑
- [x] 3.4 构建 CLI：`cd packages/cli && cargo build`
- [x] 3.5 验证 `--builtin_repo` alias：执行 `localapp init --name test-alias --builtin_repo --skip-deploy` → 成功
- [x] 3.6 验证 `--file`：创建测试 schema JSON 文件，执行 `localapp schemas create test --file schema.json` → schema 创建成功

## 4. init-repo 文档补全（init-template）

- [x] 4.1 在 `init-repo/CLAUDE.md` 的 SDK 参考章节增加 `useUpload()` Hook 文档段（签名、返回值、UploadResult 结构、示例代码）
- [x] 4.2 在 `init-repo/CLAUDE.md` 增加"文件上传 + 表单"组合模式示例（上传 → 获取 URL → 存入数据记录）
- [x] 4.3 验证：阅读 CLAUDE.md 确认 useUpload 文档完整，包含错误处理示例

## 5. 端到端验证

- [x] 5.1 按 CLAUDE.md 修正后的步骤，从头执行一次端到端测试（启动 server → init 项目 → 开发 → deploy），确认所有摩擦点已消除
