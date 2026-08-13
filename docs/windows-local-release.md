# LocalApp Windows npm 发行

Windows 与 macOS、Linux 使用同一个 `localapp` npm 包。项目不发布独立 Windows
CLI、Tauri/NSIS 客户端、托盘程序或另一套 Server。Windows 专属产物只是 npm tgz
内的极小 native adapter；它负责当前用户范围的 `localapp://` 注册、系统通知显示与
点击转发，所有鉴权、动作确认、脚本执行和应用服务仍由 Node.js daemon 中的统一
Server 完成。

## 构建环境

在 Windows x64 构建机上安装：

- Windows 10/11 x64 与 64 位 PowerShell；
- Git、Node.js 24、pnpm 10；
- Rust stable 与 `x86_64-pc-windows-msvc` target；
- Visual Studio 2022 Build Tools 的 Desktop development with C++ workload。

Rust 工具链只用于编译 npm 包内的 Windows native adapter，不用于 CLI 或 Server。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm -C packages/localapp test
pnpm -C packages/localapp test:native
pnpm -C packages/localapp build:package
```

`build:package` 必须先构建 TypeScript CLI、统一 Server、Web、模板和当前平台 native
adapter，再生成唯一可安装的 `localapp-<version>.tgz`。发行物不得要求用户另行下载
可执行 CLI、Node Server 压缩包或桌面安装器。

## Native adapter 边界

Windows adapter 必须：

- 仅在 HKCU 注册 `localapp://`，不要求管理员权限；
- 使用固定参数协议把完整 Scheme 激活转交给当前用户 daemon；
- 使用当前用户 AUMID/快捷方式显示系统通知并回传点击；
- 不解析或执行 Device Action 脚本，不保存 API Key，不监听网络端口；
- 由 npm 包清单记录路径、平台、架构、字节数和 SHA-256，daemon 使用前验证摘要。

adapter 失败不得降低 Server 的认证和权限边界。Scheme 或通知不可用时，Web 收件箱、
应用管理与前台 Server 仍应工作，并返回稳定、可诊断但不泄露秘密的错误。

## 生成与检查 npm tgz

在仓库根目录使用明确的仓库内临时目录：

```powershell
$artifactRoot = Join-Path (Get-Location) "tmp\localapp-package"
New-Item -ItemType Directory -Force $artifactRoot | Out-Null
pnpm -C packages/localapp build:package
npm pack .\packages\localapp --pack-destination $artifactRoot
```

发布前必须从全新的目录安装生成的 tgz，而不是引用 workspace：

```powershell
$acceptanceRoot = Join-Path (Get-Location) "tmp\windows-package-acceptance"
New-Item -ItemType Directory -Force $acceptanceRoot | Out-Null
Set-Location $acceptanceRoot
npm init -y
npm install ..\localapp-package\localapp-<version>.tgz
.\node_modules\.bin\localapp --version
```

检查 tgz 只包含声明的 `bin/`、`runtime/`、`template/` 与 artifact manifest。至少验证：

1. `localapp server run --host 127.0.0.1 --port 0` 能以前台模式启动同一 Server；
2. `localapp server` 能注册并启动当前用户 daemon，`status` 和 `stop` 可用；
3. daemon 默认只监听 `127.0.0.1`，首次初始化仍要求完整多用户 setup/login；
4. `localapp://` 激活只把短期票据送入 daemon，拒绝未知字段和可执行内容；
5. 显式通知测试可请求权限、显示通知并把点击送回 daemon；拒绝权限时保留 Web 收件箱；
6. `localapp init`、`check`、`build --package` 和 `app install --target local` 使用该
   tgz 完成，不依赖仓库源码或独立 Server 包。

## 签名与发布候选包

公开发布时可使用组织的 Windows 代码签名证书签署 npm tgz 内的 native adapter。
签名状态必须如实记录；没有正式证书时不得把 adapter 标记为正式签名。无论是否签名，
npm 包清单中的 SHA-256 都必须与实际 adapter 一致，包内任何字节变化都必须重新生成
清单和 tgz。

开发机生成的 tgz 只包含当前 Windows adapter，不能发布到 npm。正式发布只能使用
GitHub Release workflow 合并 Linux x64、macOS arm64、macOS x64 与 Windows x64
adapter 后生成的唯一四平台 tgz。账户准备、tag、checksum、候选包检查、2FA 手动发布
和发布后验收统一遵循 [npm 发布手册](npm-release.md)，不要从本页直接执行发布命令。

用户安装与升级路径只有 npm：

```powershell
npm install --global localapp@<version>
npm update --global localapp
```

发布后在没有仓库 checkout、没有 pnpm、没有独立 Rust CLI、没有 Tauri/WebView2
应用的干净 Windows 用户环境复验上述旅程。Node.js 是唯一安装前提；npm 安装后的
包自行提供 CLI、Server、模板和目标平台 native adapter。
