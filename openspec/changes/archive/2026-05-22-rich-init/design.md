## Context

当前 `localapp init --name <name>` 仅在当前目录创建 `manifest.json`。用户需要手动搭建 Vite + React 项目、编写 CRUD 集成代码、配置 AI 辅助工具（如 OpenCode skills）。这些工作在每个新项目中重复进行，且缺乏统一的最佳实践参考。

模板内容（Vite+React 脚手架、skills、references、docs）维护在独立的 Git 仓库中，服务器通过配置下发仓库地址。

## Goals / Non-Goals

**Goals:**
- init 命令一步生成完整的可开发项目骨架
- 通过 Git 仓库管理模板，支持版本化和社区贡献
- upload 命令支持省略路径参数，从 manifest.json 自动读取 distDir
- 服务器提供配置下发端点，CLI 无硬编码地址

**Non-Goals:**
- 不支持多种前端框架模板（固定 Vite + React）
- 不自动安装 git（仅提示下载地址）
- 不在本仓库内维护模板内容（独立 Git 仓库）
- 不支持 `.claude/skills/` 或其他 AI 工具目录

## Decisions

### 1. 模板分发方式：Git clone

**选择**: 从模板 Git 仓库 clone，删除 upstream remote。

**备选**: 从服务器 API 拉取模板文件 / 将模板 baked into CLI 二进制。

**理由**: Git 仓库天然支持版本管理（tag/branch），社区可通过 PR 贡献模板，无需在服务器端自建模板管理系统。保留 `.git/` 只删 upstream，用户拿到已初始化 git 的项目，省去 `git init` 步骤。

### 2. 配置下发方式：服务器 API

**选择**: 服务器 `/api/config` 端点下发 `templateRepoUrl` 和 `gitDownloadUrl`。

**备选**: CLI 硬编码默认地址 / CLI 配置文件 / 环境变量。

**理由**: 统一由服务器管理，自部署用户只需配置服务器的环境变量。CLI 无硬编码，不同部署环境天然隔离。`TEMPLATE_REPO_URL` 为必配项（未配置则服务器拒绝启动），`GIT_DOWNLOAD_URL` 为可选。

### 3. manifest.json 扩展

**选择**: 新增 `distDir` 字段，默认 `"dist"`。

**理由**: 固定 Vite + React 后构建产物目录确定。存入 manifest 使 upload 命令可省略路径参数。用户如自定义 `vite.config.ts` 的 `build.outDir`，手动修改 manifest 即可。

### 4. init 流程设计

```
init --name <name>
  │
  ├─ 1. 校验 name 合法性（复用 is_valid_name）
  ├─ 2. 检测 git 可用性
  │     └─ 不可用 → 打印 gitDownloadUrl，退出码 1
  ├─ 3. 检测目标目录是否已有项目（manifest.json 存在）
  ├─ 4. GET /api/config → 获取 templateRepoUrl
  ├─ 5. git clone --depth 1 <templateRepoUrl> <name>
  ├─ 6. cd <name> && git remote remove origin
  ├─ 7. 覆写 manifest.json（注入 name + distDir）
  └─ 8. 输出结果 JSON
```

clone 到以 name 命名的子目录（而非当前目录），与常见脚手架工具行为一致。如需在当前目录初始化，需 `cd` 后操作。

### 5. upload 简化

upload 命令的 path 参数变为可选：
- 提供 path → 沿用现有行为
- 省略 path → 从 manifest.json 读取 `distDir`，等价于 `upload ./<distDir>`

## Risks / Trade-offs

- **Git 依赖**: init 要求用户安装 git。缓解：检测并提示下载地址。
- **网络依赖**: clone 需要网络。与系统整体设计一致（LocalApp 本身需要网络）。
- **模板仓库可用性**: 如果模板仓库不可达，init 失败。缓解：文档中注明模板仓库的运维要求。
- **clone 到子目录 vs 当前目录**: 用户可能期望在空目录内直接 init。选择 clone 到 `<name>` 子目录符合主流工具习惯（create-react-app、cargo new 等），但如果用户已经 cd 到目标目录则体验不佳。后续可考虑 `--cwd` 标志。
