## Context

当前 CLI 的工具链循环是：

```
写代码 → npm run build → localapp upload → 浏览器刷新
```

这个循环每次需要 5-15 秒（取决于构建复杂度），并且用户必须记住执行 upload。对比 Vercel CLI (`vercel dev`) 和 Netlify CLI (`netlify dev`)，现代平台 CLI 通常提供：

- 本地 dev server 自动代理 API 请求到远程
- 脚手架生成减少手写模板代码
- 身份管理命令（whoami, logout）

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 6 的实施内容。Phase 1-5 已完成 SDK 包、前端统一、设计系统升级。

## Goals / Non-Goals

**Goals:**
- `localapp dev` 一键启动本地开发环境
- `localapp generate` 生成 schema/page/component 文件
- `localapp whoami` 和 `localapp logout` 管理用户身份

**Non-Goals:**
- 不在 CLI 中内嵌完整的 Vite 构建（dev 命令只是 `npm run dev` 的封装）
- 不实现完整的本地数据库模拟（API 请求代理到远程）
- 不实现 `localapp deploy` 别名（`upload` 已足够）

## Decisions

### Decision 1: dev 命令实现方式

**选择：** `localapp dev` 作为轻量封装，执行以下步骤：

1. 读取 `manifest.json` 获取项目配置
2. 启动 `npm run dev`（子进程）
3. 可选：启动本地 HTTP 代理转发 `/api/*` 到远程服务器
4. 打印本地访问 URL 和代理状态

**理由：** CLI 不需要重新实现 Vite 或 webpack。利用项目已有的 `npm run dev` 脚本。代理转发参考 `vercel dev` 的实现。

### Decision 2: API 代理

**选择：** 使用轻量 HTTP 反向代理（Rust 端可用 `hyper` + `http-proxy` 或直接转发）。代理规则：

- `/api/*` → 转发到配置的远程服务器（`config.server_url`）
- `/serve/*` → 同上
- 其他 → 本地 dev server 处理

**理由：** 开发时的 API 调用的认证依赖 cookie，代理到远程服务器确保认证正常工作。

### Decision 3: generate 命令

**选择：** 从内置模板生成文件。模板存储在 Rust 二进制中（类似当前 `init-repo` 的嵌入方式），但体积小得多（每个模板几十行）。

```
localapp generate schema todos
  → 生成 manifest.json 中 schemas/todos.json

localapp generate page about
  → 生成 src/pages/About.tsx (基础 React 组件骨架)

localapp generate component Button
  → 生成 src/components/Button.tsx (基础组件骨架)
```

**理由：** 减少手写模板代码。和 Rails generators、`ng generate`、`npm init` 类似。

### Decision 4: init 改用 npm 模板

**选择：** `localapp init` 默认行为改为：

```
npm create @localapp/template@latest -- --name my-app
```

或直接 `npx @localapp/create-localapp-app my-app`

保留 `--builtin-repo` 标志用于离线场景。移除编译时嵌入的完整 `init-repo/` 目录。

**理由：** 模板作为 npm 包独立更新，不需要 CLI 发版。和 `create-next-app`、`create-vite` 等模式一致。

### Decision 5: whoami / logout

**选择：** 简单的 HTTP 调用：

- `whoami` → `GET /api/me`，显示返回的 `{ id, name }`
- `logout` → 删除 `~/.localapp/work/config.json` 中的 `api_key` 字段

**理由：** 当前 CLI 没有 `login` 的身份验证反馈。用户键入 `localapp login` 后无法确认是否成功。

## Risks / Trade-offs

- **dev 代理的认证兼容性** → 代理需要正确处理 cookie 转发。使用成熟的 HTTP 代理库
- **npm 模板的可用性** → `@localapp/template` 需要发布到 npm。初期可继续使用 git clone 作为 fallback
- **CLI 二进制体积** → 移除 `init-repo/` 嵌入后体积减小。新增的 dev/generate 代码量很小
