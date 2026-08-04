## Context

当前 `localapp init` 通过 `include_dir!` 把 init-repo/ 完整复制到用户项目，复制后所有 96 个文件归用户所有，CLI 失去对它们的控制权。后续 SDK 修 bug、DevShell 改交互、skills 文档加内容（如最近的 `localapp-notify.md`），已存在的项目永远拿不到。

业界同类问题有五种解法（详见 Proposal 探索记录）：generate-and-forget、codemod、add commands、managed-files + sync、runtime-as-dependency。本项目特殊约束：

- **无 npm 仓库**：无法把 SDK / DevShell / skills 发到 npm
- **无存量用户**：重构迁移成本为零
- **目标用户混合**：小白为主、但保留高级自由度

因此选用"原子领地 + sync"路线：CLI 二进制即包源，几个明确的目录归 CLI 管，sync 时整体覆盖。

## Goals / Non-Goals

**Goals**：

- 一劳永逸的更新通道：CLI 升级后用户运行 sync（或 postinstall 自动）即拿到所有"我们的"代码最新版
- 边界清晰、心智简单：用户和 AI 都能一眼看出哪些文件归 CLI 管
- sync 算法幂等且无状态：连跑两次结果一致，不依赖 hash 或 merge
- 小白无感：clone + `npm install` 即用；高级用户可 `--interactive` 看 diff、`--off` 关闭自动、`eject` 完全脱钩

**Non-Goals**：

- 不解决用户代码自身的版本管理（App.tsx、tests/、manifest.json 等永远归用户）
- 不解决 shadcn UI 组件（`src/components/ui/*`）的更新——shadcn 的官方工具 `npx shadcn add --overwrite` 已经够用，重新拉即最新
- 不引入 npm 仓库或私有 npm registry
- 不做 codemod 式的破坏性 schema 迁移（manifest.json 字段变更仍走人工）
- 不做跨平台符号链接（Windows 不友好），用 `file:` 引用 + `npm install` 刷新

## Decisions

### Decision 1: 原子领地边界——按目录而非按文件

**选择**：CLI 拥有以下几个目录（**整个目录**归 CLI，sync 时整体覆盖）：

```
.localapp/runtime/                      ← 所有"我们的"代码
.claude/skills/localapp/                ← 主 skill
.claude/skills/localapp-ui/
.claude/skills/localapp-data/
.claude/skills/localapp-notify/
.claude/skills/localapp-auth/
.claude/skills/localapp-business/
.claude/skills/localapp-transitions/
.claude/skills/localapp-upload/
.claude/skills/agent-tool-patterns/
```

判定规则（**前缀匹配 + 路径白名单**）：
- `.claude/skills/localapp*` —— 任何以 `localapp` 开头的 skill 目录
- `.claude/skills/agent-tool-patterns/` —— 单独白名单（历史命名）
- `.localapp/runtime/` —— 整个目录

**为什么不追踪单文件 + hash**：
- 96 个文件 × 每个存 hash → 维护成本高
- 用户改了某个文件后 sync 触发三方合并 → 复杂、易出错
- 不符合"领地"直觉——边界粒度越细，越容易踩坑

**Alternative 考虑**：
- ✗ managed.json + hash + 3-way merge（D 方案）——复杂度太高，且 SDK / DevShell 这种用户从不改的代码也走 hash 是浪费
- ✗ 单一 `.localapp/runtime/` 包含 skills——Claude Code 不读 `.localapp/`，skills 必须在 `.claude/skills/`

### Decision 2: SDK 引用方式——package.json `file:` 协议

**选择**：用户 `package.json` 中：

```json
{
  "dependencies": {
    "@localapp/sdk": "file:./.localapp/runtime/sdk/core",
    "@localapp/sdk-react": "file:./.localapp/runtime/sdk/react",
    "@localapp/sdk-agent": "file:./.localapp/runtime/sdk/agent",
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}
```

`npm install` 后 `node_modules/@localapp/*` 通过软链（Unix）或复制（Windows）指向 runtime 内。用户代码 `import { useList } from "@localapp/sdk-react"` 不变。

**为什么不用 vite alias**：
- alias 需要在 vite.config.ts 和 tsconfig.json 两处维护，且 IDE（VSCode TS server）不一定跟随 vite 的 alias
- `file:` 协议是 npm 原生支持的，`node_modules` 解析机制已经被百万项目验证
- 缺点：sync 后用户要重跑 `npm install` 刷新引用——但这本来就是 sync 流程的一部分

### Decision 3: sync 算法——`rm -rf` + `extract`，无 hash

**选择**：

```
sync():
  1. 读 .localapp/runtime/version.json，与 CLI 二进制版本对比
     - 若一致且 --quiet 模式 → 提示"已是最新"，结束
     - 若不一致或 --interactive → 进入步骤 2
  2. 删除 CLI 领地:
     rm -rf .localapp/runtime/
     for each skill_dir matching localapp* or agent-tool-patterns:
       rm -rf .claude/skills/<skill_dir>/
  3. 从 CLI 二进制重新抽出:
     extract runtime/ → .localapp/runtime/
     extract each skill_dir → .claude/skills/<skill_dir>/
  4. 写入新 version.json
  5. 提示用户运行 npm install（或自动调用）
```

**幂等性**：连续跑两次结果完全一样（删除 + 重建）。

**无 hash 校验**：意味着如果用户在 `.localapp/runtime/` 里改了文件，sync 会**直接覆盖、丢失修改**。这是**故意的**——`CLAUDE.md` 顶层规则强约束"禁止修改 runtime"，用户想真正改用 `eject`。

**Alternative 考虑**：
- ✗ 三方合并 / 备份用户修改——违背"领地"概念，鼓励错误用法
- ✗ 拒绝 sync 直到用户手动备份——UX 太差，小白用户会卡住

### Decision 4: skills 重组为目录形态

**选择**：现 `.claude/skills/localapp-notify.md`（扁平文件）→ 改为 `.claude/skills/localapp-notify/SKILL.md`（一 skill 一目录）。

**为什么改形态**：
- 扁平文件 sync 时要按文件名匹配，目录形态可以按目录名整体匹配（`localapp-*/`）
- 与现有 `agent-tool-patterns/SKILL.md` 形态一致
- Claude Code skill 加载机制两种都支持，目录形态更扩展（可以放附加资源）

**Migration**：因系统未发布，无存量 skills，直接重组即可。

### Decision 5: 自动同步策略——postinstall 钩子（方案 C）

**选择**：用户 `package.json` 中注入：

```json
{
  "scripts": {
    "postinstall": "localapp sync --quiet"
  }
}
```

**行为矩阵**：

| 场景 | 命令 | 行为 |
|------|------|------|
| clone 项目首次 install | `npm install` | 自动触发 sync，runtime 就位 |
| CLI 升级后 | `localapp sync --interactive` | 显式跑，看 diff，确认升级 |
| 用户拒绝自动 | `localapp sync --off` | 写入 dev-config.json `autoSync:false`，postinstall 跳过 |
| `--quiet` 失败（CLI 不在 PATH） | postinstall | 静默跳过，不阻断 npm install |

**`--off` 实现**：在 `.localapp/dev-config.json` 加 `autoSync: false` 字段。postinstall 钩子读此字段决定是否跳过。

**`--quiet` 失败处理**：postinstall 脚本若因 CLI 缺失而失败，必须**静默退出 0**，否则会阻断 `npm install`。实现方式：脚本写成 `localapp sync --quiet || true`（shell）或包装成 node 脚本捕获异常。

**为什么是 C 而非 A 或 B**：
- ✗ A（纯显式）：小白不会主动跑，runtime 长期不更新
- ✗ B（纯自动）：高级用户失去掌控感，且每次 install 都跑增加延迟
- ✓ C（混合）：默认自动、可关、可显式——符合"小白为主 + 高级自由度"

### Decision 6: eject 命令——一次性脱钩

**选择**：`localapp eject` 执行后：

```
.localapp/runtime/                     → src/_localapp_runtime/
.claude/skills/localapp-*/             → .claude/skills/custom-localapp-*/
.claude/skills/agent-tool-patterns/    → .claude/skills/custom-agent-tool-patterns/

package.json:
  - 删除 "@localapp/sdk": "file:.localapp/runtime/sdk/core" 等
  - 改为 "file:./src/_localapp_runtime/sdk/core"
  - 删除 postinstall 钩子

.localapp/dev-config.json:
  + ejected: true   ← 永久标记，sync 拒绝执行
```

**为什么需要 eject**：高级用户可能想深度定制 DevShell 或 SDK 行为，又不想每次 sync 覆盖。eject 给他们一条明确的出路，代价是失去自动更新。

**不可逆**：eject 不提供"uneject"。如果想回到自动更新轨道，删掉 `src/_localapp_runtime/` 后重新 `localapp sync`（sync 检测到 `ejected: true` 时会提示先手动清理）。

### Decision 7: init-repo/ 源码结构调整

**选择**：init-repo/ 重组为：

```
init-repo/
├── manifest.template.json         ← 用户项目 manifest 的种子
├── package.template.json          ← 用户项目 package.json 的种子（含 file: 引用 + postinstall）
├── vite.config.ts                 ← 3 行：导入 runtime 的 plugin
├── tsconfig.json                  ← extends .localapp/runtime/tsconfig.base.json
├── vitest.config.ts               ← 简化为引用 runtime 预设
├── postcss.config.js              ← 不变
├── components.json                ← 不变（shadcn 配置）
├── index.html                     ← 不变
├── CLAUDE.md                      ← 加"禁止修改 runtime / localapp-* skills"硬约束
├── .gitignore                     ← 加 .localapp/runtime/
├── src/
│   ├── main.tsx                   ← 5 行：import DevShell from runtime
│   ├── App.tsx                    ← 不变（示例应用）
│   └── components/ui/*            ← 不变（shadcn copy-in）
├── tests/                         ← 不变
├── runtime/                       ← 新增：CLI 领地的源码（编译期 include_dir!）
│   ├── version.json               ← CLI 版本号（编译期注入）
│   ├── package.json               ← runtime 自身的依赖声明（供 IDE 解析）
│   ├── vite-plugin.ts             ← 现 vite.config.ts 的 proxy 逻辑
│   ├── dev-shell.tsx              ← 现 src/dev-shell.tsx 全量
│   ├── lib/utils.ts               ← 现 src/lib/utils.ts
│   ├── hooks/use-mobile.ts        ← 现 src/hooks/use-mobile.ts
│   ├── styles/preset.css          ← 现 src/index.css 中"我们的"部分
│   ├── tsconfig.base.json         ← 现 tsconfig.json 的 compilerOptions 部分
│   └── sdk/                       ← 现 vendor/ 内容（运行时注入）
│       ├── core/                  ← packages/sdk-core 的快照
│       ├── react/                 ← packages/sdk-react 的快照
│       └ agent/                   ← packages/sdk-agent 的快照
└── .claude/skills/
    ├── localapp/SKILL.md          ← 现 localapp.md
    ├── localapp-ui/SKILL.md       ← 现 localapp-ui.md
    ├── localapp-data/SKILL.md     ← 现 localapp-data.md
    ├── localapp-notify/SKILL.md   ← 现 localapp-notify.md
    ├── localapp-auth/SKILL.md     ← 现 localapp-auth.md
    ├── localapp-business/SKILL.md ← 现 localapp-business.md
    ├── localapp-transitions/SKILL.md
    ├── localapp-upload/SKILL.md
    └── agent-tool-patterns/SKILL.md
```

**为什么 `package.template.json` 而非直接 `package.json`**：init 时需要根据用户项目名等信息生成 `package.json`，模板与生成物分离更清晰。

**为什么 SDK 不直接 `include_dir!("$SDK_CORE_DIR")` 而要 staging 到 `runtime/sdk/`**：
- runtime/sdk/ 在 init-repo 内意味着 init-repo 自身可独立 `npm install` + `npm run build` 验证（开发体验）
- 编译期 staging 流程：build.rs 把 packages/sdk-* 复制到 init-repo/runtime/sdk/（排除 node_modules），然后 `include_dir!("$INIT_REPO_DIR")`

### Decision 8: 用户的 vite.config.ts / tsconfig.json / main.tsx 极简化

**选择**：

```ts
// vite.config.ts（用户项目，3 行）
import { defineConfig } from "vite";
import { localapp } from "@localapp/app-kit/vite";

export default defineConfig({
  plugins: [localapp()],
});
```

```json
// tsconfig.json（用户项目）
{
  "extends": "@localapp/app-kit/tsconfig.base",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

```tsx
// src/main.tsx（用户项目，5 行）
import React from "react";
import ReactDOM from "react-dom/client";
import { DevShell } from "@localapp/app-kit/dev-shell";
import App from "./App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><DevShell><App /></DevShell></React.StrictMode>
);
```

**好处**：用户的基建配置缩到极简，所有"魔法"都在 runtime 里。修 vite plugin bug → 所有项目受益。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 用户误改 `.localapp/runtime/` 内文件，sync 后丢失 | CLAUDE.md 顶层硬约束 + sync 命令在删除前打印一次警告（"以下目录将被覆盖，5 秒内 Ctrl+C 取消"）+ 提供 `eject` 出路 |
| Windows 上 `file:` 引用是 copy 不是 symlink，sync 后必须 `npm install` 刷新 | sync 命令末尾自动调用 `npm install`（或提示）；postinstall 模式下天然涵盖 |
| `localapp` 不在 PATH 时 postinstall 失败 | 钩子脚本写成 `localapp sync --quiet 2>/dev/null \|\| true`，**永远 exit 0** |
| DevShell 改坏 → 所有项目同时炸 | 单测覆盖 + CLI 版本号严控 + 用户可手动 `localapp sync --rollback <version>`（**v1 不实现**，留作未来扩展） |
| 重组 init-repo 是大改动，build.rs 编译流程要重写 | 在 design.md 详细说明 staging 流程；e2e 测试覆盖 init → build → upload → serve 全链路 |
| skills 改成目录形态后，Claude Code skill 加载机制变化导致 AI 找不到 | 目录形态是 Claude Code 原生支持的（`agent-tool-patterns` 已是此形态），加 e2e 测试验证 skill 可被发现 |
| 用户 clone 老分支（init-repo 旧结构）后用新 CLI sync，结构不匹配 | sync 检测到 `.localapp/runtime/` 不存在但项目根有 `vendor/sdk-*` 等旧痕迹时，提示"项目结构过旧，请重新 localapp init"。**因系统未发布，此场景实际不会发生，仅作未来兼容性预留** |

## Migration Plan

由于系统未公开发布、无存量用户，**无迁移**。流程是：

1. 重组 init-repo/ 源码（runtime/ 子目录、skills 目录化、根目录极简化）
2. 改写 packages/cli/src/template.rs 区分"用户领地"和"CLI 领地"两套抽取
3. 改写 packages/cli/src/commands/init.rs 在用户 package.json 注入 postinstall
4. 新增 packages/cli/src/commands/sync.rs
5. 新增 packages/cli/src/commands/eject.rs
6. 更新 build.rs 把 packages/sdk-* staging 到 init-repo/runtime/sdk/
7. 更新 init-repo/CLAUDE.md 加"禁止修改 runtime"硬约束
8. 更新 init-repo/tests/ 中受影响的测试

**回滚策略**：所有改动在 `runtime-zone-sync` 特性分支上进行，merge 到 main 前可整体放弃。merge 后回滚需要 revert merge commit + 重新初始化所有测试项目（可接受）。

## Open Questions

- **sync 是否应该自动调用 `npm install`？** 倾向于"是"，但需要考虑 `npm install` 可能很慢、用户可能用 pnpm/yarn。**决定**：sync 只刷新 runtime 文件，结尾提示"运行 `npm install` 刷新依赖"；postinstall 钩子本身就是 install 的一部分，所以那个场景天然涵盖
- **eject 后的目录命名**：`src/_localapp_runtime/` vs `src/localapp-runtime/` vs `vendor/localapp-runtime/`？倾向 `src/_localapp_runtime/`（下划线前缀表明"非应用代码"）——**实施时再决定**
- **runtime/version.json 的内容**：`{ "cliVersion": "0.5.0" }` 一个字段够吗？还是要包含 `sdkVersion`、`templateHash` 等子版本？倾向**最小化**——只有一个 `cliVersion`，因为整体 atomic 更新不需要细粒度版本——**实施时确认**
