# 在线创建应用验证

## 已通过

- Web 开发界面及 Shell：39 个测试文件，361 个测试通过。创建对话单项测试在焦点恢复调整后再次通过。
- Server 源码、创建、构建、发布相关：6 个测试文件，16 个测试通过。
- Server TypeScript 检查及 Web 正式构建通过。
- 已配置的真实模型：在「我的应用」打开 shadcn Dialog，讨论需求，提交名称 `creation-flow-demo`，点击确认进入正式应用地址；原需求、名称提案及后续消息属于同一会话，默认开发者模式并自动开始编辑。
- Agent 将模板主标题改为「项目进度看板」。首次执行重复尝试未安装依赖的检查，测试中停止该轮，并在同一会话要求直接说明结果。已补充系统提示，说明依赖和构建由平台提供。
- 对话结束后自动编译预览，显示在正式应用页内。预览创建工作项、开始处理的真实读写通过；刷新恢复历史并重新打开预览，没有再次触发创建继续请求。
- 浏览器最初拦截了不同站点 iframe 的 SameSite=Lax 预览 Cookie；改为 Secure、HttpOnly、SameSite=None、Partitioned 后，实际嵌入预览与读写通过。平台身份和预览身份仍分开。
- 创建弹窗模型下拉展开、选中态、Escape 关闭下拉及弹窗、焦点返回「创建应用」按钮通过。
- 嵌入预览隐藏内部重复导航栏，保留正式平台导航和底部对话。
- Server 测试覆盖跨用户拒绝、未提案不能确认、错误名称拒绝、重复确认只安装一个版本、原会话保留与一次继续；预览构建不能发布，完整发布构建仍执行失败的测试脚本。

截图和日志放在 `tmp/platform-development/`：`create-dialog.png`、`creation-inline-preview.png`、`creation-web-tests.log`、`creation-server-focused-tests.log`、`creation-web-build.log`。

## 未通过的完整模板发布构建

`development-template.test.ts` 的真实 builtin 构建失败。模板中的两项 `vite-proxy-security.test.ts` 测试需要监听本机端口，离线沙箱返回 `listen EPERM`，随后超时。未修改测试脚本、跳过测试或放宽执行环境。该测试与本次预览编译的成功结果分别记录，不能将预览成功视为发布检查通过。
