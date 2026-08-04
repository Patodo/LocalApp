## ADDED Requirements

### Requirement: CLI upload 端到端验证

测试 SHALL 通过 CLI `upload` 命令验证文件上传完整链路。

#### Scenario: 上传包含子目录的项目
- **WHEN** 执行 `localapp upload ./dist`，`dist/` 包含 `index.html`、`assets/style.css`、`assets/app.js`
- **THEN** CLI 输出 `{ "pageId", "url", "version": 1 }`，退出码 0；文件可通过 `/serve/` 路径访问

#### Scenario: 上传空目录
- **WHEN** 执行 `localapp upload ./empty-dir`，目录为空
- **THEN** CLI 输出错误 JSON 到 stderr，退出码 1

### Requirement: 版本管理端到端验证

#### Scenario: 多次上传版本递增
- **WHEN** 对同一页面连续执行两次 `localapp upload`
- **THEN** 第一次输出 `version: 1`，第二次输出 `version: 2`

#### Scenario: 通过 pages info 查看版本历史
- **WHEN** 执行 `localapp pages info` 查看已上传两次的页面
- **THEN** 返回 `versionCount: 2`，`versions` 数组包含两个版本记录
