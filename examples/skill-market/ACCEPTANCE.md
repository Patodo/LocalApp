# SKILL 市场本地验收

该应用由 builtin `localapp init` 生成，使用通用 SDK `device.run()`。点击安装时，应用只把短期激活票据交给当前电脑注册的 `localapp://` bridge；脚本和技能正文留在 Server action payload 中。

验收目标：

1. 通过根目录的 `pnpm test:real-apps` 构建时，目录输入默认指向仓库内 `tmp/single-package-acceptance/installed-skills`；其他构建方式可以显式改为用户选择的绝对目录。
2. 安装确认展示目标路径、`filesystemWrite` 权限和不启用 `childProcess`。
3. 本机 Server 完成 Device Action 后，`localapp-device-actions/SKILL.md` 只出现在选定目录下，返回路径、字节数和 SHA-256 digest。
4. 失败时保留可重试状态，不留下 `.tmp-*` 临时文件。

正式入口必须是 `/<owner>/skill-market/`；`/serve/` 仅作 API 诊断。

浏览器验收必须使用 `browser:control-in-app-browser`。安全策略阻止自动打开外部 Scheme 时，保留页面和请求状态，由用户在同一台电脑手动点击；不得改用 shell、直接 activation API 或其他浏览器绕过该边界。确定性 Server 测试单独覆盖 ticket、信任和脚本执行。
