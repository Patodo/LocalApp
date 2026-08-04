## MODIFIED Requirements

### Requirement: new 命令

CLI SHALL 提供 `new` 命令，读取 manifest.json 中的 name，在服务端创建页面。manifest.json 中不再写入 pageId。

#### Scenario: 成功创建
- **WHEN** 执行 `localapp new` 且已配置 serverUrl 和 apiKey，manifest.json 包含合法 name
- **THEN** POST `/api/pages`（携带 name），服务端返回页面信息，输出 `{ "name": "...", "url": "..." }`

#### Scenario: 未登录
- **WHEN** 执行 `localapp new` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

#### Scenario: 无 manifest.json
- **WHEN** 执行 `localapp new` 但当前目录没有 manifest.json
- **THEN** 输出错误 JSON `{"error": "No manifest.json found. Run 'localapp init' first."}`

#### Scenario: manifest.json 无 name
- **WHEN** 执行 `localapp new`，manifest.json 存在但 name 字段为空
- **THEN** 输出错误 JSON `{"error": "No name in manifest.json"}`

#### Scenario: 页面已存在
- **WHEN** 执行 `localapp new`，但服务端该用户下已有同名页面
- **THEN** 输出错误 JSON `{"error": "Page name already exists"}`

### Requirement: upload 命令

CLI SHALL 提供 `upload [path]` 命令，从 manifest.json 读取 name，将文件上传到对应页面。path 参数可选，省略时从 manifest.json 的 `distDir` 字段读取。上传时每个文件 part 前附带 `filepath_{index}` 字段保留子目录结构。

#### Scenario: 成功上传（显式路径）
- **WHEN** 执行 `localapp upload ./dist`，manifest.json 存在且包含 name，目录包含文件
- **THEN** 递归读取目录文件，multipart POST 到 `/api/upload`（带 name 和 filepath 字段），输出 `{ "name", "url", "version" }`

#### Scenario: 省略路径参数
- **WHEN** 执行 `localapp upload`（无路径参数），manifest.json 包含 `"distDir": "dist"`
- **THEN** 使用 `./dist` 作为上传目录，行为与显式指定一致

#### Scenario: 省略路径但无 distDir
- **WHEN** 执行 `localapp upload`，manifest.json 不包含 distDir 字段
- **THEN** 输出错误 JSON `{"error": "No distDir in manifest.json and no path specified"}`
