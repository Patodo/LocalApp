## ADDED Requirements

### Requirement: CLAUDE.md 包含 useUpload Hook 文档

`init-repo/CLAUDE.md` SHALL 包含 `useUpload()` Hook 的完整文档，包括函数签名、参数说明、返回值类型（`{ upload, loading, error }`）、`UploadResult` 结构（`{ key: string, url: string }`）和使用示例。

#### Scenario: CLAUDE.md 包含 useUpload 文档
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含 `useUpload()` Hook 的 TypeScript 示例代码、返回值说明、以及 `UploadResult` 的 key/url 结构

#### Scenario: CLAUDE.md 包含文件上传模式示例
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含一个完整的"文件上传 + 表单提交"组合模式示例，展示如何在上传后获取 URL 并存入数据记录

#### Scenario: CLAUDE.md 包含上传错误处理
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含 try/catch 捕获上传错误的示例代码，使用 `LocalAppError` 类型
