## Context

当前模板项目（`init-repo/`）和平台服务存在多个导致新用户首次开发体验断裂的问题。这些问题由一次零上下文 Agent 开发测试暴露——一个全新 Agent 在没有人类指导的情况下，从 `localapp init` 到成功部署应用，共遇到 7 个阻碍。本设计聚焦其中影响最大、修复代价最低的问题。

### 当前状态

```
用户视角的首次体验路径：

localapp init
  ↓
CLI 输出 URL: http://.../serve/testuser/bug-tracker  ← 输出了 /serve/ 路径
  ↓
用户访问 /serve/.../ (无尾斜杠)
  ↓
浏览器加载 HTML，但 assets 路径解析错误
  ↓
/assets/index-xxx.js → /serve/testuser/assets/... → 404  ← 相对路径漂移
  ↓
白屏
```

### 关键约束

- Fastify 配置了 `ignoreTrailingSlash: true`，影响路由匹配行为
- Vite 构建产物使用 SPA 模式，所有资源路径必须与 HTML base 一致
- 模板需要兼容 `localapp init` 的 builtin fallback（git clone 失败时）
- SDK 客户端已兼容 `/api/me` 返回 null 和 401 两种响应

## Goals / Non-Goals

**Goals:**
- 模板默认 `base: "./"` 确保首次构建即可正确加载
- `/serve/:userId/:name` 无尾斜杠 → 301 重定向确保浏览器路径基准正确
- CLI `init` 输出 shell wrapper 路径而非直接 serve 路径
- 模板 CLAUDE.md 显式标注 ESM import 和 Agent 闭包模式

**Non-Goals:**
- 不修改 SDK 的 `useMe` 行为（当前已正确处理 null/401 两种场景）
- 不修改 `/api/me` 返回码（改为 401 是 breaking change，当前 200+null 是合法设计）
- 不修改 CLI 的 CWD 依赖行为（CLI 工具定位 manifest.json 的 CWD 模式是标准做法，无需改变）
- 不添加 CLI 到系统 PATH（这是发布/安装层面的问题，超出本变更范围）

## Decisions

### 决策 1: Vite base 使用 `"./"` 而非绝对路径

**选择**: 模板 `vite.config.ts` 默认设置 `base: "./"`

**备选方案**:
- ❌ 设置 `base: "/serve/{user}/{app}/"` — 模板构建时不知道用户名和应用名，无法静态配置
- ❌ 让平台在 serve 时注入 `<base>` 标签 — 复杂、容易出错、对已有应用不兼容
- ✅ `base: "./"` — 对所有部署路径都适用，零配置，浏览器按相对路径正确解析

**原理**: 相对路径是嵌入到未知深度路径的应用的标准实践。无论平台路径是 `/{user}/{app}/` 还是 `/serve/{user}/{app}/` 还是其他，`./assets/x.js` 都能正确解析。

### 决策 2: 301 重定向而非修改 ignoreTrailingSlash

**选择**: 在 `/serve/:userId/:name` 精确路由中检测 `req.url` 是否以 `/` 结尾，无斜杠时返回 301 重定向

**备选方案**:
- ❌ 关闭全局 `ignoreTrailingSlash` — 影响所有路由，breaking change
- ❌ 仅依赖 `ignoreTrailingSlash` 实现规范 — 规范后的 URL 不会反映到浏览器地址栏，所以相对路径仍会基于原始 URL 解析
- ✅ 301 重定向 — 标准 Web 实践，浏览器更新地址栏，相对路径基于正确基准解析

**实现要点**:
```typescript
// 在 /serve/:userId/:name 路由内部
if (!req.url.split("?")[0].endsWith("/")) {
  return reply.redirect(301, `/serve/${userId}/${name}/`);
}
```

Fastify 的 `ignoreTrailingSlash: true` 不会修改 `req.url`，只影响路由匹配。因此可以通过检查 `req.url` 判断是否需要重定向。

### 决策 3: CLI 输出快捷 URL（shell wrapper 路径）

**选择**: `localapp init` 成功时输出 `http://{host}/{userId}/{name}/` 格式而非 `/serve/...`

**原理**: shell wrapper（`/:userId/:name`）包含平台导航栏和用户菜单，是面向用户的入口。直接 serve（`/serve/...`）是 iframe 嵌入的内部实现细节，不应暴露给终端用户。

## Risks / Trade-offs

- **`base: "./"` 与绝对路径的潜在冲突**: 如果用户手动添加了绝对路径的 `<link>` 或 `<script>`，这些不受影响。但如果用户的代码中有硬编码的 `/assets/...` 路径，将不再工作。→ **Mitigation**: 模板从一开始就引导用户使用相对路径或 SDK 导入
- **301 重定向增加一次请求**: 每次无尾斜杠访问会增加一次 HTTP 往返。→ **Mitigation**: 浏览器缓存 301（永久重定向），后续访问直接走正确 URL。在开发阶段这个开销可忽略
- **文档一致性风险**: CLAUDE.md 中的代码示例需要和实际 SDK 行为严格一致。→ **Mitigation**: 在更新文档后运行一次完整的 init → build → upload 流程验证

## Open Questions

- `/api/me` 是否应该在后续版本中改为返回 401？这需要评估所有客户端的兼容性
