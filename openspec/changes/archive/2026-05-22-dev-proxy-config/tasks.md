## 1. CLI init 写入 dev-config

- [x] 1.1 [GREEN] 修改 `packages/cli/src/commands/init.rs`：在写 manifest.json 之后，创建 `.localapp/` 目录并写入 `dev-config.json`，内容为 `{ "serverUrl": "<config.server_url>" }`
- [x] 1.2 验证：在临时目录手动测试 init 命令，确认 `.localapp/dev-config.json` 被正确创建
- [x] 1.3 commit: `feat(cli): init 命令写入 .localapp/dev-config.json`

## 2. 模板 Vite 代理配置

- [x] 2.1 [GREEN] 修改 `init-repo/vite.config.ts`：读取 `.localapp/dev-config.json` 中的 serverUrl，配置 `server.proxy` 将 `/api` 和 `/serve` 转发到该地址
- [x] 2.2 [GREEN] 创建 `init-repo/.gitignore`：排除 `.localapp/dev-config.json`、`node_modules/`、`dist/`
- [x] 2.3 验证 `npm run build` 仍然成功（proxy 仅 dev 生效）
- [x] 2.4 commit: `feat(init-template): 添加 Vite 代理配置和 .gitignore`

## 3. E2E 测试

| Spec Scenario | E2E Test | Status |
|---|---|---|
| cli-tool > Scenario: 合法 name | 验证 init 后 .localapp/dev-config.json 存在且内容正确 | ✓ |
| init-template > Scenario: 有 dev-config 时代理生效 | 验证 vite.config.ts 包含 proxy 配置 | ✓ |
| init-template > Scenario: 无 dev-config 时不报错 | 删除 dev-config 后 vite build 仍然成功 | ✓ |
| init-template > Scenario: 生产构建不受影响 | npm run build 成功且不含 proxy 运行时代码 | ✓ |
| init-template > Scenario: dev-config 不被提交 | .gitignore 排除 .localapp/dev-config.json | ✓ |

- [x] 3.1 [GREEN] 为 cli-tool > Scenario: 合法 name (dev-config) 编写 e2e 测试
- [x] 3.2 [GREEN] 为 init-template > Scenario: 代理配置/无 dev-config/生产构建 编写 e2e 测试
- [x] 3.3 [GREEN] 为 init-template > Scenario: .gitignore 编写 e2e 测试
- [x] 3.4 执行全部 e2e 测试，验证通过
- [x] 3.5 更新映射表中所有 Status 为 ✓
- [x] 3.6 commit: `test: 添加 dev-proxy e2e 测试`
