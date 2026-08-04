## 1. TDD: 本地文件存储写入

- [x] 1.1 RED — 编写 `local-storage.test.ts`，测试本地写入和读取：写入 Buffer 到本地存储路径，断言文件存在且内容一致，读取返回正确 Content-Type。运行测试确认失败（尚无本地存储模块）。
- [x] 1.2 GREEN — 在 `s3-client.ts` 中新增本地存储函数 `putLocalObject(key, body, contentType)` 和 `getLocalObject(key)`。`putLocalObject` 将文件写入 `dataDir/{key}`，`getLocalObject` 从文件系统读取。同时添加 MinIO 可用性检测逻辑：`ensureBucket` 失败时设置 `useLocalStorage = true` 并在控制台打印提示。
- [x] 1.3 COMMIT — `git commit` ✓ (done)

## 2. TDD: 存储后端分发

- [x] 2.1 RED — 扩展测试：模拟 `useLocalStorage` 模式，调用 `putObject`/`getObject` 验证分发到本地存储。运行测试确认当前 S3 路径在无 MinIO 时失败。
- [x] 2.2 GREEN — 修改 `putObject`/`getObject` 函数，根据 `useLocalStorage` 标志分发到 `putLocalObject`/`getLocalObject` 或 S3 SDK。`getObject` 返回签名 `{ body: Buffer; contentType?: string } | null` 不变。
- [x] 2.3 COMMIT — `git commit` ✓ (done)

## 3. 构建验证与 e2e 测试

- [x] 3.1 运行 `npm run build` 确保编译通过
- [x] 3.2 运行 `npm test` 确保所有测试通过
- [x] 3.3 e2e 验证：重启 server（不启动 MinIO），通过 curl 上传测试文件到 `/api/content/upload`，确认返回 201 和正确的 `key`/`url`，再通过返回的 url 读取文件确认内容一致
