## Context

公开首页是 LocalApp 的用户入口，承担两个职责：CLI 二进制分发和新用户引导。当前实现存在两个 bug：
1. `/api/cli/download` 未设 `Content-Disposition` header，浏览器将文件保存为无意义的 `download`
2. 首页工作流缺少 `localapp login` 步骤，用户拿到 CLI 后无法连接到当前实例

## Goals / Non-Goals

**Goals:**
- 修复 CLI 下载文件名，让用户拿到可直接识别和执行的二进制
- 在首页展示完整的新用户引导流程，包含 login 步骤和自动填充的 server 地址
- 下载按钮根据 server 实际可用的平台动态展示

**Non-Goals:**
- 不改变 CLI 二进制存储路径或命名规则
- 不改变 `versions.json` 的结构
- 不实现 CLI 自动安装（如包管理器集成）

## Decisions

### 1. Content-Disposition 文件名策略

`/api/cli/download` 根据 `os` 查询参数决定文件名：
- `windows` → `localapp.exe`
- 其他 → `localapp`

**理由**：用户不需要知道 target triple，只需要一个可执行的命令名。CLI 本身通过 `localapp` 或 `localapp.exe` 调用。

### 2. Server 地址自动填充

公开首页已运行在目标 server 上，使用 `window.location.origin` 拼接 login 命令，展示为可复制的代码块。

**理由**：首页自身知道自己的地址，无需额外配置。用户复制粘贴即可。

### 3. 动态平台下载按钮

首页在渲染时调用 `/api/cli/version`（公开接口），读取 `versions.json` 中的平台列表，为每个可用平台生成下载按钮。根据 `navigator.platform` 高亮推荐当前用户的平台。

**理由**：避免硬编码平台，不同部署可能编译了不同平台的二进制。

## Risks / Trade-offs

- [versions.json 不存在时无下载按钮] → 首页降级展示纯文本指引，不报错
