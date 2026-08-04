## ADDED Requirements

### Requirement: useUpload Hook

SDK SHALL 提供 `useUpload()` Hook，返回 `{ upload: (file: File) => Promise<UploadResult>, loading: boolean, error: LocalAppError | null }`。`upload` 函数将文件以 `multipart/form-data` 形式 POST 到 `{basePath}/content/upload`。

`UploadResult` 类型 SHALL 为 `{ key: string; url: string }`。

#### Scenario: 成功上传图片
- **WHEN** 调用 `upload(file)` 且 file 为 PNG 图片
- **THEN** 请求 `POST {basePath}/content/upload`，body 为 `FormData` 包含该文件，返回 `{ key: "abc123.png", url: "/serve/.../api/content/abc123.png" }`

#### Scenario: 上传中 loading 状态
- **WHEN** `upload(file)` 正在执行
- **THEN** `loading` 为 `true`

#### Scenario: 上传完成 loading 归位
- **WHEN** `upload(file)` 执行完成（成功或失败）
- **THEN** `loading` 为 `false`

#### Scenario: 上传失败
- **WHEN** 服务端返回 401
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 401`

#### Scenario: 文件类型不支持
- **WHEN** 服务端返回 400 (unsupported file type)
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 400`

#### Scenario: 文件过大
- **WHEN** 服务端返回 413
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 413`
