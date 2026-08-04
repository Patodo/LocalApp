## Context

当前 `localapp init --name X` 的执行流程：验证名称 → git clone 模板 → 写 manifest.json → 结束。用户还需要手动执行 5 步才能看到页面。PinMe 的 `pinme create` 一步完成所有操作（含首次部署），体验更流畅。

现有 CLI 结构：
- `init.rs`：克隆模板 + 写 manifest.json
- `new.rs`（new_page.rs）：POST /api/pages 注册页面
- `upload.rs`：读取 dist 目录 → multipart upload
- `client.rs`：HTTP 客户端，封装 API 调用
- `project.rs`：读取 manifest.json

关键约束：
- CLI 是 Rust 实现（clap + reqwest）
- 需要 `localapp login` 先完成认证（有 API key 才能调 POST /api/pages 和 POST /api/upload）
- 内网环境可能无法安装 npm 依赖

## Goals / Non-Goals

**Goals:**
- `localapp init` 一条命令完成：脚手架 → 安装依赖 → 注册页面 → 构建 → 上传 → 打印 URL
- 支持 `--skip-deploy` 跳过部署步骤（离线/内网场景）
- 未登录时降级为脚手架模式，打印后续步骤提示

**Non-Goals:**
- 不改变服务端 API
- 不删除 `new` 命令（保留作为单独注册页面的入口）
- 不改变 upload 命令的现有行为

## Decisions

### 1. 在 init.rs 内联 new + upload 逻辑，而非调用子命令

Rust CLI 中通过函数调用复用逻辑，而不是通过 `Command::new("localapp")` 调自身。这样避免进程间通信，且共享 client 配置。

具体做法：将 `new_page.rs` 中的 `create_page()` 和 `upload.rs` 中的 `upload_files()` 提取为 `client.rs` 的公共方法，init 调用这些方法。

### 2. npm install 和 npm run build 通过 std::process::Command 调用

在 Rust 中用 `std::process::Command::new("npm")` 执行子进程，检查退出码，失败时中断流程并打印错误。

### 3. 登录检测：读取 config 文件判断是否有 api_key

在执行部署步骤前，检查 `~/.localapp/config.json` 中是否有 api_key。无则跳过部署，打印提示。

### 4. 打印访问 URL

upload 成功后，拼接 `{server_url}/{userId}/{pageName}` 打印。userId 从 upload 响应中获取（或从 API key 验证接口获取）。

## Risks / Trade-offs

- [npm install 可能因网络问题失败] → init 显示清晰的错误信息，用户可手动 `cd && npm install` 继续
- [构建时间较长] → 用 println! 显示进度（"正在安装依赖..."、"正在构建..."），借鉴 PinMe 用 ora spinner 的模式
- [首次 init 失败但目录已创建] → 不做回滚，用户可 cd 进去手动继续（与 PinMe 策略一致）
