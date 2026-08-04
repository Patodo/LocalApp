## 1. CLI 模板后处理：修复 workspace:* 依赖解析

- [x] 1.1 在 `packages/cli/src/template.rs` 中新增 `extract_sdk_vendor` 函数，将 `packages/sdk-{core,react,agent}/` 源码拷贝到目标项目 `vendor/` 目录
- [x] 1.2 在 `packages/cli/src/template.rs` 中新增 `postprocess_package_json` 函数，读取 `package.json` 并将 `"workspace:*"` 替换为 `"file:./vendor/{pkg-name}"`
- [x] 1.3 新增清理 vendor 内 SDK `package.json` 中残留 `workspace:*` 的逻辑（替换为 `"*"`）
- [x] 1.4 在 `packages/cli/src/commands/init.rs` 的 `prepare_template_builtin` 后调用后处理函数
- [x] 1.5 编写 Rust 单元测试：验证 package.json 后处理正确替换 workspace:* 引用
- [x] 1.6 端到端验证：`localapp init --name test-vendor --skip-install --skip-deploy --builtin-repo`，检查 vendor 目录和 package.json 内容
- [x] 1.7 验证 `npm install` 在提取后的项目中成功执行
- [x] 1.8 Commit: `fix(cli): 模板提取后处理解决 workspace:* 依赖解析问题`

## 2. 修复 useExec CRUD 模式访问

- [x] 2.1 修改 `packages/server/src/routes/serve.ts:238`，移除 `mode !== "sql"` 检查
- [x] 2.2 在 `packages/server/src/lib/app-db.ts` 的 `execRawSql` 中添加 DROP TABLE 防护：CRUD 模式下检测目标表是否在 schemas 中，若存在则拒绝
- [x] 2.3 编写服务器端测试：CRUD 模式下 `POST /api/db/exec` SELECT 查询返回成功
- [x] 2.4 编写服务器端测试：CRUD 模式下 `DROP TABLE` 受管表返回 400
- [x] 2.5 编写服务器端测试：CRUD 模式下 `DROP TABLE` 非受管表正常执行
- [x] 2.6 更新 `init-repo/.claude/skills/localapp-data.md` 文档：说明 CRUD 模式下 raw SQL 绕过 routeAccess
- [x] 2.7 端到端验证：在 CRUD 模式应用中调用 useExec 执行聚合查询
- [x] 2.8 Commit: `fix(server): CRUD 模式开放 useExec 并添加 DROP TABLE 防护`

## 3. 修复 useList 依赖和模板测试

- [x] 3.1 修改 `packages/sdk-react/src/hooks/use-list.ts`：使用 `useMemo` 序列化 options 作为稳定依赖
- [x] 3.2 编写测试：验证 options 对象值不变时不触发多余请求
- [x] 3.3 检查 init-repo 的 vitest 配置文件，添加 `resolve.alias` 解决双 React 实例
- [x] 3.4 运行 `pnpm test` 验证模板测试全绿
- [x] 3.5 Commit: `fix(sdk-react): 稳定 useList options 依赖并修复模板测试双 React 实例`

## 4. Mutation hooks 添加 onSuccess 回调

- [x] 4.1 修改 `packages/sdk-react/src/hooks/use-create.ts`：添加可选 `options.onSuccess` 参数
- [x] 4.2 修改 `packages/sdk-react/src/hooks/use-update.ts`：添加可选 `options.onSuccess` 参数
- [x] 4.3 修改 `packages/sdk-react/src/hooks/use-delete.ts`：添加可选 `options.onSuccess` 参数
- [x] 4.4 编写测试：验证 `onSuccess` 回调在操作成功后被调用
- [x] 4.5 编写测试：验证不提供 options 时行为与修改前完全一致（向后兼容）
- [x] 4.6 更新 `init-repo/CLAUDE.md` 文档：说明 onSuccess 回调用法
- [x] 4.7 端到端验证：在应用中使用 `useCreate("todos", { onSuccess: refresh })` 并确认回调触发
- [x] 4.8 Commit: `feat(sdk-react): mutation hooks 添加 onSuccess 回调支持`
