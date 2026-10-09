## Why

开发者目前需要在本机维护应用源码、依赖、构建和安装命令。LocalApp 已有 dsh 文件与终端能力、用户模型配置及应用版本安装能力，可以把这些能力连接为浏览器内开发流程，让开发者在同一平台完成应用开发和发布。

## What Changes

- 统一 Server 保存应用开发项目、源码历史、开发工作区、构建记录和预览数据；源码与正式应用运行产物独立。
- 增加开发界面：Agent 对话、文件编辑、改动查看、构建日志、预览、发布和恢复源码版本。
- 开发 Agent 复用 dsh 和当前用户模型配置，工作目录由项目与开发会话确定，不随模型供应商变化。
- 抽取 CLI 已有模板、项目检查和打包逻辑供 Server 调用，继续复用现有安装、数据维护和版本切换流程。
- 开发者权限与应用使用权限分开；预览使用独立数据和浏览器 origin；发布只能由具有发布权限的用户明确操作。
- 第一阶段交付单开发者 builtin 模板完整流程；后续增加源码导入导出、多人独立工作区和外部 Git 同步。

## Capabilities

### New Capabilities
- `platform-app-development`：项目源码管理、开发 Agent、构建预览与发布。

### Modified Capabilities
- 无；实施时若改变现有 CLI 或安装行为，补充对应规格。现有应用包格式与正式入口保持兼容。

## Impact

影响 packages/server、packages/web、packages/sdk-agent 和 packages/localapp 的项目工具实现。仍只安装一个 localapp npm 包，只运行统一 Server。构建子进程不是独立应用后端。新增管理员开发环境与资源额度设置，增加源码备份容量；现有应用不会自动获得可编辑源码。
