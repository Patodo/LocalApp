# LocalApp Electron 桌面预览

在仓库根目录安装并启动：

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Electron 使用 `@patodo/localapp` npm 包启动自己的统一 Server，监听本机随机端口，数据保存在桌面端的用户数据目录。首次启动会打开本机初始化页，设置本机管理员后通过 LocalApp 菜单进入首页登录。若初始化链接失效，可在 LocalApp 菜单选择“重新打开初始化”。退出桌面端时会停止它启动的 Server。远端部署仍可使用 `localapp server run`。

在当前平台生成桌面预览包：

```sh
npm --prefix desktop run package
```

预览包同时带有经校验的 Node.js 运行时，用户无需另装 Node.js。桌面预览包位于 `tmp/localapp-desktop-dist/`。macOS 包声明了 `localapp://`；桌面端收到 Device Action 票据后，把票据交给本机 Server，再打开确认页面。Windows 安装器、系统实际唤起和动作执行仍需验收。

Windows x64 可从当前开发机交叉打包：

```sh
npm --prefix desktop run package -- --windows
```

Windows 预览目录需要整体解压后双击 `LocalApp.exe`，首次运行会尝试注册 `localapp://`。不要把单个 exe 从目录中移出。macOS 预览镜像内可将 `LocalApp.app` 拖到“应用程序”。预览产物未做发行签名或公证。

## 影子应用

在桌面端打开“对端连接”，选择已配置的对端，点击“浏览对端应用”。选择“影子”后，
桌面端在当前窗口同步前端文件。同步完成后，在“我的应用”中找到带“影子”标记的应用，
从列表打开会在同一个窗口进入应用。可用顶部的“返回 LocalApp”回到列表。
“复制”安装应用包并使用本机数据库。两端都需要支持对端应用目录接口，来源 Server 需保留当前发布的应用包。

已同步的应用在对端目录显示“已影子”，可从“我的应用”打开。影子模式在本机保存经校验的前端文件，
业务请求直接访问来源 Server。两端都需要支持影子会话接口。远端按对端 API Key 确定账号，
签发只能访问该应用的短期会话。API Key 保存在本机 Server，桌面页面无需另行登录远端。
断开连接时隐藏应用内容并显示状态。

应用在 `manifest.json` 中声明全局快捷键。例如：

```json
{
  "desktop": {
    "shortcuts": [
      {
        "id": "create-todo",
        "label": "新建待办",
        "accelerator": "CommandOrControl+Alt+N",
        "route": "?action=create-todo"
      }
    ]
  }
}
```

`id` 在应用内唯一。组合键使用 CommandOrControl、Control、Alt、Shift 或 Super，
加一个 A–Z、0–9 或 F1–F24。动作打开应用原地址并附加声明的查询参数，应用按参数处理
对应动作。快捷键默认关闭。可在“影子应用”菜单或当前本机应用的 LocalApp 菜单启用；
本机应用也需要运行包含前端清单接口的 Server。发生内部冲突时，由用户选择保留哪一个动作。
