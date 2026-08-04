## 1. TDD: insertRow defaultValue 修复

- [x] 1.1 RED — 编写 `crud-db.test.ts`，加入 `insertRow applies defaultValue` 测试用例：创建含 `defaultValue: "open"` 的 status 字段的 schema，不传 status 执行 insertRow，断言返回记录的 status 为 `"open"`。同时覆盖 defaultValue 为 false、0、显式传值覆盖默认值的情况。运行测试确认失败。
- [x] 1.2 GREEN — 修改 `crud-db.ts` 的 `insertRow` 函数第 313 行，在 `else if (field.type === "timestamp")` 之后增加 `else if (field.constraints?.defaultValue !== undefined)` 分支，将 defaultValue 加入 columns 和 values。运行测试确认通过。
- [x] 1.3 COMMIT — `git commit` ✓ (done)

## 2. TDD: alterTableAddColumn defaultValue 回填

- [x] 2.1 RED — 扩展测试用例：先用无 `defaultValue` 字段的 schema 插入记录，再调用 `alterTableAddColumn` 添加含 `defaultValue: "normal"` 的字段，断言存量行的该字段值为 `"normal"`。运行测试确认失败。
- [x] 2.2 GREEN — 修改 `crud-db.ts` 的 `alterTableAddColumn` 函数，在 ALTER TABLE 后检查 `fieldType` 对应的字段约束（需新增 `fieldConstraints` 参数或通过 `DataSchema` 获取），若含 `defaultValue` 则执行 `UPDATE <table> SET <column> = ?`。运行测试确认通过。
- [x] 2.3 COMMIT — `git commit` ✓ (done)

## 3. 构建与回归验证

- [x] 3.1 运行 `npm run build` 确保编译通过
- [x] 3.2 运行 `npm test` 确保所有测试通过
- [x] 3.3 e2e 验证：重启 server，创建含 `defaultValue` 字段的 schema，curl 调用 POST API 不带该字段，确认返回记录包含默认值
