## 1. 类型文件迁移

- [x] 1.1 将 `packages/shared/src/models.ts` 复制到 `packages/server/src/types/models.ts`
- [x] 1.2 将 `packages/shared/src/api.ts` 复制到 `packages/server/src/types/api.ts`
- [x] 1.3 将 `packages/shared/src/mcp.ts` 复制到 `packages/server/src/types/mcp.ts`

## 2. Import 路径替换

- [x] 2.1 替换 `packages/server/src/lib/crud-db.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.2 替换 `packages/server/src/routes/serve.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.3 替换 `packages/server/src/routes/upload.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.4 替换 `packages/server/src/routes/schemas.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.5 替换 `packages/server/src/routes/pages.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.6 替换 `packages/server/src/plugins/storage.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.7 替换 `packages/server/src/lib/access-control.ts` 中的 `@localapp/shared` import 为相对路径 `../types/models.js`
- [x] 2.8 替换测试文件中的 `@localapp/shared` import 为相对路径

## 3. 清理依赖与配置

- [x] 3.1 从 `packages/server/package.json` 移除 `@localapp/shared` workspace 依赖
- [x] 3.2 从根 `tsconfig.json` 移除 shared 的 references
- [x] 3.3 删除 `packages/shared/` 目录

## 4. 验证

- [x] 4.1 运行 `pnpm build` 验证 TypeScript 编译通过
- [x] 4.2 运行 `npx vitest run` 验证全部测试通过
