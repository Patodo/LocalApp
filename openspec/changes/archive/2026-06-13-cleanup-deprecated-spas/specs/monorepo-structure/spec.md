## ADDED Requirements

### Requirement: 废弃 package 的彻底清理

当一个 TypeScript 子包被标记为 DEPRECATED 且其功能已迁移到其他 package 时，该 package SHALL 从仓库中**物理删除**，而不只是保留代码 + 加 DEPRECATED.md 标记。pnpm-workspace.yaml、root package.json 的 build scripts、Dockerfile 的 COPY 行 MUST 同步移除对该包的所有引用。

**理由**：保留废弃代码会持续制造歧义——贡献者和 AI 工具容易把改动错误地写进不再被构建/服务的代码。git 历史已经提供了完整的可追溯性，仓库工作树只应保留"当前生效"的代码。

#### Scenario: 工作树不保留废弃 package
- **WHEN** 一个 package 的功能已迁移到 `packages/web/`，且自身不再被任何其他 package `import`
- **THEN** 该 package 的目录（含 src/、package.json、tsconfig.json、构建配置、DEPRECATED.md）MUST 不存在于工作树中

#### Scenario: workspace 配置同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** `pnpm-workspace.yaml` 中 MUST 不再包含该 package 的路径条目

#### Scenario: build scripts 同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** root `package.json` 的 scripts 段 MUST 不再包含针对该 package 的构建命令（如 `build:<name>`）

#### Scenario: Dockerfile 同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** `Dockerfile` MUST 不再 `COPY` 该 package 的任何文件

#### Scenario: 仓库可追溯性
- **WHEN** 需要查看已删除 package 的历史代码
- **THEN** 通过 `git show` / `git log -- <path>` 从历史提交中检索，不依赖工作树
