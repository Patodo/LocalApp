## Why

当前 `localapp init` 仅创建一个 `manifest.json` 文件，用户需要自行搭建前端项目、编写 CRUD 集成代码、配置 AI 辅助开发环境。这导致每次新项目都要重复相同的前置工作，且缺乏统一的最佳实践参考。init 应该一步到位地生成一个可直接开发的完整项目骨架。

## What Changes

- `localapp init --name <name>` 从服务器获取模板 Git 仓库地址，clone 模板到目标目录，删除上游 remote，注入 manifest.json
- manifest.json 新增 `distDir` 字段，默认值 `"dist"`，供 `upload` 命令自动读取
- `upload` 命令支持省略路径参数，从 manifest.json 读取 `distDir`
- 服务器新增 `/api/config` 端点，下发 `templateRepoUrl` 和 `gitDownloadUrl` 配置
- 服务器启动时校验 `TEMPLATE_REPO_URL` 环境变量，未配置则拒绝启动；`GIT_DOWNLOAD_URL` 为可选配置
- CLI 在 init 时检测 git 是否可用，不可用则提示服务器下发的下载地址后退出
- 模板仓库包含：标准 Vite + React 脚手架、`.opencode/skills/localapp.md`、`.localapp/references/`（完整样例项目）、`.localapp/docs/`、`.gitignore`

## Capabilities

### New Capabilities
- `project-init`: init 命令的完整脚手架能力，包括 git clone、模板注入、git 检测与提示
- `server-config`: 服务器配置下发端点，提供模板仓库地址和工具下载链接

### Modified Capabilities
- `cli-tool`: init 命令行为变更（从仅写 manifest.json 变为完整脚手架），upload 命令支持省略路径参数
- `create-page-api`: 服务器新增 `/api/config` 端点

## Impact

- **CLI (Rust)**: `init` 命令重写（git clone + remote remove + manifest 注入）；`upload` 命令支持读 `distDir`；新增 `/api/config` 调用
- **Server (TypeScript)**: 新增 `/api/config` 路由；启动时校验 `TEMPLATE_REPO_URL` 环境变量
- **外部依赖**: 模板 Git 仓库需独立维护（不在本仓库内）
- **兼容性**: init 行为完全变更，原 `init --name` 仅写 manifest.json 的行为被替换
