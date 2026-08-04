## 1. 首页工作台

- [x] 1.1 RED：确认首页组件存在乱码文案和模块入口需求
- [x] 1.2 GREEN：修复 `/` 首页中文文案、空状态、加载状态和三个模块入口
- [x] 1.3 REFACTOR：整理首页数据类型和重复渲染逻辑，保持组件可读
- [x] 1.4 验证：首页通过 Web 构建或类型检查
- [x] 1.5 修正：未登录访问 `/` 时渲染公开首页，不自动跳转登录页

## 2. CLI release 产物目录

- [x] 2.1 RED：确认当前 `build:cli` 只构建二进制，未发布到 server 静态目录
- [x] 2.2 GREEN：新增 CLI release 发布脚本，将当前平台二进制复制到 `packages/server/static/cli/{version}/`
- [x] 2.3 GREEN：发布脚本更新 `versions.json`，保留既有平台条目
- [x] 2.4 REFACTOR：将根脚本整理为跨平台可运行命令，避免非 macOS 环境执行 `codesign`
- [x] 2.5 验证：运行发布脚本或 dry-run，并确认目标路径和清单结构

## 3. 收尾

- [x] 3.1 运行 `openspec status --change add-home-and-cli-artifacts`
- [x] 3.2 运行相关测试或构建命令
- [x] 3.3 更新任务清单勾选已完成项
