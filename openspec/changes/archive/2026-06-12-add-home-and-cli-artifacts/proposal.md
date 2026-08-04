## Why

当前平台已经有首页入口和 CLI 更新接口，但首页文案存在乱码，且编译后的 CLI 产物缺少一个稳定、可重复的落盘流程。用户需要一个可用的首页作为工作入口，也需要明确知道 release CLI 应放到哪里，方便 server 提供下载和后续自动更新。

## What Changes

- 修复并完善 `/` 首页，使其作为已登录用户的工作台入口，展示我的应用、收藏应用和最近访问。
- 为 CLI release 产物建立明确的输出约定：构建后复制到 server 可读取的静态目录，并维护版本清单。
- 增加脚本或工具流程，避免手工猜测 CLI 二进制文件应放置的位置。
- 不引入破坏性变更。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `home-page`: 修正首页实际渲染体验，确保中文文案正常、入口链接可用、模块加载状态独立。
- `cli-update`: 明确编译后的 CLI 产物应发布到 server 静态 CLI 目录，并由版本清单驱动下载。

## Impact

- 影响 Next.js Web 首页：`packages/web/app/(dashboard)/page.tsx`。
- 影响 CLI 构建和发布脚本：根 `package.json`、可能新增脚本文件。
- 影响 server 静态 CLI 目录约定：`packages/server/static/cli/`。
- 可能补充面向构建产物发布的测试或文档说明。
