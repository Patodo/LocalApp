## Context

当前 `localapp init` 的完整流程是：获取 server config 中的模板仓库 URL → `git clone --depth 1` → `npm install` → 注册页面 → `npm run build` → 上传 dist。所有步骤都依赖网络和 git，导致 CI 环境和离线场景无法使用。

init-repo 目录已经存在于项目根目录，是一个完整的 Vite + React + TypeScript 项目模板。目标是让 CLI 编译时打包这个模板，init 时解压使用，跳过 git clone 但保留 npm install 和 build。

CLI 基于 Rust，使用 clap 做 CLI 解析，reqwest 做 HTTP 请求。

## Goals / Non-Goals

**Goals:**
- CLI 二进制内置 init-repo 模板源码，无网络时仍可 init
- 保留 `npm install` + `npm run build` 步骤，确保项目完整可用
- 有 git URL 配置时仍走 git clone 流程（向后兼容）
- E2E 测试可在无外网环境下运行

**Non-Goals:**
- 不改变 init-repo 的内容和结构
- 不跳过 npm install/build（那是生产项目必须的）
- 不支持用户自定义内置模板
- 不做模板版本管理（内置模板随 CLI 版本更新）

## Decisions

### Decision 1: 使用 Rust `include_dir` crate 打包模板

编译时将 `init-repo/` 目录嵌入到 CLI 二进制中。

**选择**: `include_dir` crate
**替代方案**:
- `std::include_str!` — 不支持目录，需逐文件声明，维护成本高
- 构建脚本 + `xz` 压缩嵌入 — 更复杂，收益有限

`include_dir` 支持目录递归嵌入，编译时检查路径存在性，API 简洁。代价是二进制体积增大约 50-200KB（init-repo 源码较小）。

### Decision 2: 模板来源默认 git，自动回退内置，支持 --builtin-repo 强制内置

```
--builtin-repo 指定？
       │
    yes├── no
       │      │
       ▼      ▼
  内置模板   服务端有 git URL？
                  │
               yes├── no
                  │      │
                  ▼      ▼
              git 可用？  内置模板
                  │
               yes├── no
                  │      │
                  ▼      ▼
              git clone  内置模板
                  │
              成功？
               │   │
             yes├── no
               │      │
               ▼      ▼
             继续   清理 + 回退内置模板
```

默认优先使用服务端 git URL，失败自动回退。`--builtin-repo` 跳过所有 git 逻辑。

### Decision 3: 内置模板解压后照样 npm install + build

解压 init-repo 源码到目标目录后，后续流程与 git clone 完全一致：`npm install` → 注册页面 → `npm run build` → 上传。不跳过任何步骤。

### Decision 4: init-repo 路径在 Cargo.toml 中配置

通过环境变量 `INIT_REPO_DIR` 在 build.rs 中传递给 `include_dir!` 宏。默认值为项目根目录下的 `../../init-repo`（相对于 `packages/cli/`）。

## Risks / Trade-offs

- **二进制体积增加** → init-repo 源码约 30-50KB（不含 node_modules），可接受
- **内置模板可能过时** → 随 CLI 版本发布更新，通过 `pnpm sync:sdk` 保持 SDK 同步后编译即可
- **npm install 仍需网络** → 这是不可避免的，项目运行需要依赖；但 git 不再是必需品
- **CI 需要 npm** → E2E 测试环境需要 Node.js，但这已由 vitest/playwright 隐含要求
