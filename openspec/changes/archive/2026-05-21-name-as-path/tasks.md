## 1. Name Validation 函数

### RED
- [x] 1.1 为 server 端 `validateName` 函数编写单元测试（覆盖：合法名称、大小写、下划线、数字开头、连续连字符、首尾连字符、长度、空字符串、保留词）

### GREEN
- [x] 1.2 实现 server 端 `validateName` 函数（packages/server/src/lib/validate-name.ts）

### REFACTOR
- [x] 1.3 审查 validateName 实现，确保正则清晰、保留词列表可维护

### 验证
- [x] 1.4 运行 `pnpm --filter server test` 确认所有 validateName 测试通过

## 2. Shared Types 更新

### RED
- [x] 2.1 更新 packages/shared/src/models.ts：Page 移除 id，新增 name 作为标识符；DataSchema 的 pageId 改为 pageName

### GREEN
- [x] 2.2 更新 packages/shared/src/api.ts：所有 API 类型中 pageId 替换为 name/pageName

### 验证
- [x] 2.3 运行 `pnpm --filter shared build` 确认类型编译通过

## 3. Server Storage 更新

### RED
- [x] 3.1 更新 packages/server/src/plugins/storage.ts：PageMeta 中 pageId 改为 name，所有函数参数 pageId 改为 name

### GREEN
- [x] 3.2 更新 getPageDir、getPageMetaPath、readPageMeta、writePageMeta 使用 name 参数

### 验证
- [x] 3.3 运行 `pnpm --filter server build` 确认编译通过（后续步骤修复路由中的引用）

## 4. Server Pages 路由更新

### RED
- [x] 4.1 为 POST /api/pages 编写测试：接收 name、校验格式、校验唯一性、返回 name 和 url

### GREEN
- [x] 4.2 更新 POST /api/pages：接收 name 参数，调用 validateName 校验，检查用户级唯一性，使用 name 创建目录
- [x] 4.3 更新 GET /api/pages：返回数据中 pageId 替换为 name
- [x] 4.4 更新 GET /api/pages/:name 和 DELETE /api/pages/:name：路由参数从 pageId 改为 name

### 验证
- [x] 4.5 运行 server 测试确认 pages 路由通过

## 5. Server Upload 路由更新

### RED
- [x] 5.1 更新 POST /api/upload：接收 name 字段替代 pageId，使用 name 查找页面目录

### GREEN
- [x] 5.2 实现变更：从 multipart 读取 name，使用 name 定位页面，返回数据中 pageId 替换为 name

### 验证
- [x] 5.3 运行 server 测试确认 upload 路由通过

## 6. Server Serve + CRUD 路由更新

### RED
- [x] 6.1 更新 iframe wrapper 路由：/:userId/:pageId 改为 /:userId/:name
- [x] 6.2 更新 static serve 路由：/serve/:userId/:pageId 改为 /serve/:userId/:name
- [x] 6.3 更新 CRUD API 路由：handleCrudRequest 中所有 pageId 引用改为 name

### GREEN
- [x] 6.4 实现所有路由变更，更新 serve.ts 中 pageId → name

### 验证
- [x] 6.5 运行 server 测试确认 serve 路由通过

## 7. Server Schemas 路由更新

### RED
- [x] 7.1 更新 POST /api/schemas：接收 pageName 参数替代 pageId
- [x] 7.2 更新 GET/PUT/DELETE /api/schemas：查询参数 pageId 改为 pageName

### GREEN
- [x] 7.3 实现所有 schemas 路由变更

### 验证
- [x] 7.4 运行 `pnpm --filter server test` 确认所有 server 测试通过
- [x] 7.5 运行 `pnpm --filter server build` 确认编译通过，commit 此阶段

## 8. CLI Manifest 更新

### RED
- [x] 8.1 更新 packages/cli/src/project.rs：Manifest 移除 page_id 字段，name 改为必填（String 非 Option）

### GREEN
- [x] 8.2 实现 Manifest 结构变更，更新 read/write 方法

### 验证
- [x] 8.3 确认 CLI 编译通过

## 9. CLI Init 命令更新

### RED
- [x] 9.1 更新 is_valid_name 函数：收紧为 kebab-case 规则（小写+数字+连字符、字母开头、3-63字符、禁止连续/首尾连字符、保留词检查）

### GREEN
- [x] 9.2 实现新验证规则

### 验证
- [x] 9.3 确认 init 命令编译通过

## 10. CLI New/Upload/Pages/Schemas 命令更新

### RED
- [x] 10.1 更新 new_page.rs：从 manifest 读取 name，POST /api/pages 发送 name，不再写入 page_id
- [x] 10.2 更新 upload.rs：从 manifest 读取 name 替代 page_id，发送 name 到 upload API
- [x] 10.3 更新 pages.rs：路由参数和查询参数从 pageId 改为 name
- [x] 10.4 更新 schemas.rs：查询参数从 pageId 改为 name，resolve_page_id 改为 resolve_page_name
- [x] 10.5 更新 client.rs：upload_with_description 参数从 page_id 改为 name

### GREEN
- [x] 10.6 实现所有 CLI 命令变更

### 验证
- [x] 10.7 运行 `cargo build` 确认 CLI 编译通过，commit 此阶段

## 11. 端到端验证

### RED
- [x] 11.1 清理 data/ 目录中的旧数据
- [x] 11.2 手动验证完整工作流：init → new → upload → pages info → serve → schemas create → CRUD

### GREEN
- [x] 11.3 修复端到端验证中发现的问题

### 验证
- [x] 11.4 完整工作流通过，commit 最终状态
