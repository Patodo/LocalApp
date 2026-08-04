## Context

平台目前已经有 `/` 首页、用户应用/收藏/最近访问接口，以及 `/api/cli/version`、`/api/cli/download` 两个 CLI 更新接口。问题在于首页实现中的中文文案已经乱码，影响实际使用；CLI release 二进制虽然可由 server 静态目录下载，但缺少从 `cargo build --release` 到 `packages/server/static/cli/{version}/` 的稳定发布步骤。

## Goals / Non-Goals

**Goals:**

- 让 `/` 成为可直接使用的中文首页，已登录用户可快速进入我的应用、收藏和最近访问。
- 保持三个首页模块独立加载，单个接口失败不阻塞其他模块。
- 将 release CLI 产物复制到 `packages/server/static/cli/{version}/`，并更新 `versions.json`，使现有下载接口可以直接提供文件。
- 让本地开发者通过脚本完成 CLI 构建和发布产物整理。

**Non-Goals:**

- 不新增 CLI 下载 API。
- 不改变 CLI 自更新协议。
- 不引入跨平台 CI 发布流水线。
- 不改变用户、页面、收藏或最近访问的数据模型。

## Decisions

- 首页继续放在 Next.js dashboard 根页面 `packages/web/app/(dashboard)/page.tsx`。这样能复用现有 dashboard layout、登录态 cookie 和 `/api/me/*` 接口；替代方案是新增单独 landing page，但会绕开已存在的应用工作台规格。
- 首页文案直接修复为 UTF-8 中文，并保持当前的三个模块布局。这样风险最小；替代方案是整体重做信息架构，但会扩大变更范围。
- CLI release 产物放在 `packages/server/static/cli/{version}/`。server 的 `cliRoutes` 已经从该目录读取 `versions.json` 和二进制文件，沿用此路径可以避免改动下载接口。
- 新增脚本负责从 Cargo target 复制当前平台二进制，并更新 `versions.json`。替代方案是仅文档化手工复制路径，但容易产生漏更新版本清单的问题。

## Risks / Trade-offs

- [Risk] 本地构建平台只能发布当前平台的二进制文件。→ 版本清单只更新当前平台条目，其他平台可由后续 CI 或对应平台开发机补齐。
- [Risk] `codesign` 只适用于 macOS，Windows/Linux 上直接执行会失败。→ 构建脚本需要在非 macOS 环境跳过签名，或将签名步骤放入跨平台脚本中判断。
- [Risk] 首页接口响应结构和类型可能与组件假设不一致。→ 实施时根据现有接口测试和页面代码对齐字段，并运行 web 构建验证。

## Migration Plan

1. 修复首页组件文案和状态渲染。
2. 新增 CLI release 产物整理脚本，并在根 `package.json` 暴露命令。
3. 运行构建或类型检查验证。
4. 回滚时移除脚本和首页改动即可，server 下载接口不需要迁移。

## Open Questions

- 是否需要在 CI 中自动构建全部平台 CLI 产物，本次先不处理。
