## MODIFIED Requirements

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，从 manifest.json 读取 name，自动执行 SDK 刷新、构建和上传。帮助文本 SHALL 使用中文描述命令用途和参数含义。

upload 命令 SHALL 按以下顺序执行：
1. 读取 manifest.json 获取 name 和 distDir
2. 用内置模板覆盖用户项目的 `src/lib/localapp/`（SDK 自动刷新）
3. 执行 `npm run build` 构建
4. 收集构建产物并上传

#### Scenario: 成功上传（完整流程）
- **WHEN** 执行 `localapp upload`，manifest.json 存在且包含 name
- **THEN** 刷新 SDK → 构建 → 收集 dist 文件 → multipart POST 到 `/api/upload`，输出 `{ "name", "url", "version" }`

#### Scenario: 指定路径上传
- **WHEN** 执行 `localapp upload ./custom-dist`
- **THEN** 使用指定路径作为 dist 目录，跳过 SDK 刷新和构建步骤，直接收集并上传指定目录

#### Scenario: 无 manifest.json
- **WHEN** 执行 `localapp upload` 但当前目录没有 manifest.json
- **THEN** 输出错误 JSON `{"error": "No manifest.json found. Run 'localapp init' first."}`

#### Scenario: manifest.json 无 name
- **WHEN** 执行 `localapp upload`，manifest.json 存在但 name 为空
- **THEN** 输出错误 JSON `{"error": "No name in manifest.json"}`

#### Scenario: 构建失败
- **WHEN** `npm run build` 执行失败（编译错误等）
- **THEN** 输出错误信息到 stderr，退出码非 0，不执行上传

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp upload --help`
- **THEN** path 参数描述为中文，说明不指定路径时自动构建并上传

#### Scenario: 上传含子目录的文件保留路径
- **WHEN** 构建产物包含 `index.html` 和 `assets/style.css`
- **THEN** CLI 发送 `filepath_0: "index.html"`、`filepath_1: "assets/style.css"` 字段，服务端按路径存储
