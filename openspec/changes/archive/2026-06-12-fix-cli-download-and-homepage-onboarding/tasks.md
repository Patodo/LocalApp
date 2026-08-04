## 1. 修复 CLI 下载文件名

- [x] 1.1 RED：确认 `/api/cli/download` 响应缺少 `Content-Disposition` header
- [x] 1.2 GREEN：在 `packages/server/src/routes/cli.ts` 的 download handler 中添加 `Content-Disposition` header，根据 `os` 参数返回 `localapp.exe`（Windows）或 `localapp`（其他平台）
- [x] 1.3 验证：curl 下载确认 header 正确

## 2. 公开首页引导流程重构

- [x] 2.1 RED：确认公开首页工作流缺少 `localapp login` 步骤，下载按钮硬编码 Windows x64
- [x] 2.2 GREEN：在 `PublicHome` 组件中添加 `/api/cli/version` 调用，获取可用平台列表
- [x] 2.3 GREEN：重构工作流步骤为三步引导：下载 CLI → 连接到实例（`localapp login <origin>`）→ 创建应用
- [x] 2.4 GREEN：下载区域根据 `versions.json` 中的平台动态生成下载按钮，当前平台高亮
- [x] 2.5 GREEN：`/api/cli/version` 返回 404 或无平台时，降级展示纯文本
- [x] 2.6 验证：访问 `http://localhost:3001/` 确认引导流程完整展示

## 3. 收尾

- [x] 3.1 运行 `pnpm -C packages/web build` 确认构建通过
- [x] 3.2 更新任务清单勾选已完成项
