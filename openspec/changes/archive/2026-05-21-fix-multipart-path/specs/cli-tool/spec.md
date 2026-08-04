## MODIFIED Requirements

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，将指定目录的文件上传到 `.localapp.json` 中对应的页面。不接受 `--page-id` 参数。上传时每个文件 part 前附带 `filepath_{index}` 字段保留子目录结构。

#### Scenario: 成功上传
- **WHEN** 执行 `localapp upload ./dist`，`.localapp.json` 存在且有效，目录包含文件
- **THEN** 递归读取目录文件，multipart POST 到 `/api/upload`（带 pageId 和 filepath 字段），输出 `{ "pageId", "url", "version" }`

#### Scenario: 无 .localapp.json
- **WHEN** 执行 `localapp upload ./dist` 但当前目录没有 `.localapp.json`
- **THEN** 输出错误 JSON `{"error": "No project found. Run 'localapp new' first."}`

#### Scenario: 目录不存在
- **WHEN** 指定的 path 不存在或不是目录
- **THEN** 输出错误 JSON `{"error": "Directory not found: <path>"}`

#### Scenario: 上传含子目录的文件保留路径
- **WHEN** 执行 `localapp upload ./dist`，dist 包含 `index.html` 和 `assets/style.css`
- **THEN** CLI 发送 `filepath_0: "index.html"`、`filepath_1: "assets/style.css"` 字段，服务端按路径存储
