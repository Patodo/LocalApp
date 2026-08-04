## 0. 前置：更新项目文档

- [ ] 0.1 更新 `openspec/config.yaml` 上下文，说明用户通过 CLI 创建的项目基于 Vite + React
- [ ] 0.2 更新 `README.md`，移除 MCP 相关描述，反映项目实际定位；补充说明 CLI init 生成的项目为 Vite + React 脚手架

## 1. 服务器端：配置校验与下发

- [ ] 1.1 服务器启动时校验 `TEMPLATE_REPO_URL` 环境变量，未配置则拒绝启动并输出错误日志
- [ ] 1.2 新增 `GET /api/config` 路由（需鉴权），返回 `{ templateRepoUrl, gitDownloadUrl }`
- [ ] 1.3 编写 `/api/config` 端点的 e2e 测试：已鉴权返回配置、未鉴权返回 401、GIT_DOWNLOAD_URL 可选

## 2. CLI：init 命令重写

- [ ] 2.1 Manifest struct 新增 `distDir` 字段，默认值 `"dist"`
- [ ] 2.2 init 命令重写：校验 name → 检测 git → GET /api/config → git clone → remove upstream → 写 manifest.json
- [ ] 2.3 git 不可用时输出下载提示（从服务器获取 gitDownloadUrl），退出码 1
- [ ] 2.4 目标目录已存在时返回错误
- [ ] 2.5 git clone 失败时输出错误信息

## 3. CLI：upload 命令支持省略路径

- [ ] 3.1 upload 命令 path 参数改为可选，省略时从 manifest.json 读取 `distDir`
- [ ] 3.2 无 distDir 且无路径参数时输出错误

## 4. e2e 测试

- [ ] 4.1 编写 init 命令 e2e 测试：成功初始化、name 不合法、目录已存在
- [ ] 4.2 编写 upload 省略路径 e2e 测试：从 distDir 读取、无 distDir 报错
