## Context

LocalApp 当前使用随机生成的 pageId（nanoid 或 `crypto.randomBytes(8).toString("hex")`）作为页面的唯一标识符。pageId 出现在 URL 路径（`/{userId}/{pageId}`）、存储目录（`data/{userId}/{pageId}/`）、manifest.json 的 pageId 字段、以及所有 API 路由参数中。

CLI 的 `init` 命令已允许用户为项目指定 `name`（当前规则：`[a-zA-Z0-9_-]`），但 name 仅作为展示字段存储在 manifest.json 中，不参与路由或存储。

本变更将 name 从展示字段提升为唯一标识符，完全取代 pageId。

## Goals / Non-Goals

**Goals:**
- URL 可读、可记忆：`/{userId}/my-cool-app` 替代 `/{userId}/01755ac162c4133c`
- name 成为页面的唯一标识，简化数据模型（移除 pageId 字段）
- 服务端和 CLI 使用统一的 name 验证规则
- name 在用户级唯一（不同用户可拥有同名页面）

**Non-Goals:**
- 页面重命名支持（删除旧页面 + 创建新页面可作为替代方案，后续可按需添加）
- 全局唯一 name（会导致好名字被抢光）
- 已有数据迁移（项目未发布，无生产数据）
- name 作为 DNS 子域名（仅作为 URL 路径组件）

## Decisions

### Decision 1: name 验证规则

采用类似 DNS hostname 的 kebab-case 规则，比当前 CLI 的 `[a-zA-Z0-9_-]` 更严格：

- 只允许小写字母、数字、连字符（`-`）
- 必须以字母开头
- 长度 3-63 字符
- 禁止连续连字符（`--`）
- 禁止首尾连字符

**备选方案**: 保持当前宽松规则（允许大写、下划线）。**否决理由**: URL 中大写和下划线不友好，且不符合当前互联网主流 slug 风格。

**实现方式**: 验证逻辑抽取为独立函数，服务端（TypeScript）和 CLI（Rust）各自实现相同规则。不需要 shared 包，因为 CLI 是 Rust。

### Decision 2: pageId 完全移除，不做别名

name 直接作为存储目录名和路由参数，不保留内部 pageId 映射。

**备选方案**: 内部保留 pageId，name 作为 URL 别名，通过映射表查找。**否决理由**: 增加不必要的复杂度（映射表、双索引），当前阶段不需要重命名支持。

### Decision 3: CLI new 命令发送 name

`localapp new` 不再创建随机 pageId，而是将 manifest.json 中的 name 发送给服务端。服务端校验 name 合法性和用户级唯一性后创建页面目录。

**CLI manifest.json 变化**:
```
之前: { "name": "my-app", "description": "...", "page_id": "0175..." }
之后: { "name": "my-app", "description": "..." }
```

name 成为必填字段，移除 page_id 字段。

### Decision 4: 存储路径直接使用 name

```
之前: data/{userId}/{pageId}/
之后: data/{userId}/{name}/
```

meta.json 中的 pageId 字段替换为 name 字段。

## Risks / Trade-offs

- **[文件系统特殊字符]** name 包含连字符，在文件系统路径中安全。→ 无需额外处理
- **[重名冲突]** 同一用户下两个 CLI 项目使用相同 name 会冲突。→ 服务端返回 409，CLI 提示用户更改 name
- **[name 不可变]** 一旦创建无法改名。→ 可通过删除旧页面 + 创建新页面的方式解决，后续可添加 rename 支持
- **[URL 路径冲突]** name 可能与 `/api/`、`/serve/` 等保留路径冲突。→ 验证规则中加入保留词列表
