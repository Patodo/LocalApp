## Tasks

- [x] **Task 1: 添加 include_dir 依赖并配置构建脚本**
  Cargo.toml 添加 `include_dir` 依赖，build.rs 设置 `INIT_REPO_DIR` 环境变量默认值，声明 `static BUILTIN_TEMPLATE: Dir`。验证 `cargo build` 通过且二进制包含模板文件。

- [x] **Task 2: 实现内置模板解压逻辑**
  template.rs 增加 `extract_builtin_template()` 函数，遍历 BUILTIN_TEMPLATE 目录树写入文件，排除 node_modules/dist。单元测试验证解压功能。

- [x] **Task 3: 重构 init 流程支持模板来源自动切换**
  重构 init.rs run() 函数：服务端有 templateRepoUrl 且 git 可用时走 git clone，否则使用内置模板。git clone 失败时自动回退内置模板。提取 prepare_template_git()、prepare_template_builtin()、write_project_files()、deploy_project()。

- [x] **Task 4: sync:sdk 验证和最终构建**
  运行 pnpm sync:sdk 确保 SDK 同步，重新编译验证内置模板中 SDK 文件已更新。
