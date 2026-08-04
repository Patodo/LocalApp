## Context

CLI 使用 `include_dir!` 宏在编译时内嵌整个 init-repo 目录（含 265MB node_modules），导致二进制 221MB。macOS 的 AMFI 机制会杀死 linker-signed 二进制在新路径下的执行（exit 137）。两个独立 context-free Agent 测试均确认 CLI 完全不可用。

## Goals / Non-Goals

**Goals:**
- CLI 二进制在任何 macOS 路径下均可正常执行（无 exit 137）
- 二进制体积 < 30MB（当前 221MB）
- sqlAccess 权限拒绝时提供可操作的配置指引
- 上传和 sqlAccess 行为在文档中有清晰说明

**Non-Goals:**
- 不修改 include_dir crate 本身
- 不改变 CLI 的运行时行为（init/upload 命令接口不变）
- 不实现完整的 codesign 分发（仅 ad-hoc 签名，不做 notarization）

## Decisions

### 1. build.rs staging 目录排除 node_modules

在 `build.rs` 中将 init-repo 复制到 `target/init-repo-staging/`，排除 `node_modules/`、`dist/`、`.next/`，然后 `include_dir!` 指向 staging 目录。

**替代方案：** 编写 pre-build 脚本手动清理。排除原因：build.rs 是 cargo 依赖追踪的正确位置，`cargo clean` 自动清理 staging 目录。

**理由：** staging 目录放在 `target/` 下，cargo clean 会自动清理。rerun-if-changed 指令确保模板变更触发重编译。

### 2. Ad-hoc codesign 而非 codesign 脚本

在 `npm run build:cli` 脚本中追加 `codesign -s -` 命令。

**理由：** codesign 必须在二进制生成后执行，不能放在 build.rs 中（build.rs 运行在编译阶段）。npm script 是最简洁的集成点。

### 3. sqlAccess 403 错误信息内联指引

直接在 403 响应中包含 manifest.json 配置提示，而非单独的错误码系统。

**理由：** 开发者看到 403 时需要立即知道如何修复，不需要查阅额外文档。

## Risks / Trade-offs

- **[Risk] staging 目录占用额外磁盘** → `target/` 目录本身就是临时的，`cargo clean` 清理，影响可忽略
- **[Risk] rerun-if-changed 不够精确** → 使用具体文件路径而非通配符，cargo 能正确追踪变更
- **[Risk] codesign 仅在 macOS 有效** → 在 Linux 上 codesign 不存在时脚本会失败；后续可加 `|| true` 或平台判断，当前仅 macOS 开发环境受影响
- **[Trade-off] staging 复制增加编译时间** → init-repo 不含 node_modules 后仅 ~2MB 文件，复制耗时 <100ms
