## 1. Server 端修复 (RED → GREEN → 验证)

- [x] 1.1 编写 e2e 测试：CLI 上传含子目录的项目后，通过 `/serve/.../assets/style.css` 可正确访问文件（RED）
- [x] 1.2 修改 `packages/server/src/routes/upload.ts`：读取 `filepath_{index}` 字段，优先作为存储路径，回退到 `part.filename`
- [x] 1.3 运行 e2e-cli 测试确认通过，提交 commit

## 2. CLI 端修复 (RED → GREEN → 验证)

- [x] 2.1 编写 e2e 测试：CLI upload 后 pages info 确认文件按子目录路径存储（RED，依赖 1.2）
- [x] 2.2 修改 `packages/cli/src/client.rs`：为每个文件 part 前插入 `filepath_{index}` text field
- [x] 2.3 运行 e2e-cli 测试确认通过，提交 commit

## 3. 验证

- [x] 3.1 运行全部测试（e2e + e2e-cli）确认无回归，提交 commit

## 4. e2e Scenario 覆盖映射表

| Spec | Scenario | 测试文件 | Status |
|------|----------|----------|--------|
| file-upload > Multipart 文件上传 > 带 filepath 字段的子目录文件 | upload.ts + serve.test.ts | tests/e2e-cli/upload.test.ts | ✓ |
| file-upload > Multipart 文件上传 > 不带 filepath 字段时回退到 filename | 现有 e2e 测试覆盖 | tests/e2e/upload.test.ts | ✓ |
| cli-tool > upload 命令 > 上传含子目录的文件保留路径 | upload.test.ts | tests/e2e-cli/upload.test.ts | ✓ |
