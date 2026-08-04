## Why

公开首页是用户接触 LocalApp 的第一个页面，承担 CLI 分发和新用户引导的职责。当前存在两个关键问题：1) CLI 下载接口未设置 `Content-Disposition` header，浏览器将文件保存为无扩展名的 `download`，用户无法识别；2) 首页工作流缺少 `localapp login` 步骤，用户下载 CLI 后不知道如何连接到当前实例。

## What Changes

- CLI 下载接口 (`/api/cli/download`) 添加 `Content-Disposition` header，根据请求的 OS 参数返回正确文件名（`localapp.exe` / `localapp`）
- 公开首页工作流步骤中增加 `localapp login` 引导，自动填充当前 server 地址
- 公开首页下载按钮根据 `versions.json` 中实际可用的平台动态展示，替代当前硬编码的 Windows x64 按钮

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cli-update`: 下载接口需返回正确文件名
- `home-page`: 公开首页工作流增加 login 步骤，下载按钮动态展示可用平台

## Impact

- `packages/server/src/routes/cli.ts`：下载路由添加 Content-Disposition header
- `packages/web/app/(dashboard)/page.tsx`：PublicHome 组件更新工作流步骤和下载区域
