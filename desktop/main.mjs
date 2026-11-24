import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import { randomBytes } from "node:crypto";
import { DesktopShortcuts, readShortcutDeclarations } from "./shortcuts.mjs";
import { listSyncedShadows, openShadowView, parseShadowSource } from "./shadow.mjs";
import { resolveDeviceActivation } from "./device-activation.mjs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

let origin;
let server;
let window;
let quitting = false;
let stopped = false;
let windowReady = false;
let handlingActivation = false;
let pendingConfirmation;
const deviceControlToken = randomBytes(32).toString("base64url");
const pendingActivations = [];

const shortcuts = new DesktopShortcuts();
const shadowRoot = () => path.join(app.getPath("userData"), "shadow");
let shadow;
let refreshMainMenu;

async function openShadow(input, openAfterSync = false, peerRoute) {
  if (shadow || quitting || !window || window.isDestroyed()) return;
  const current = {};
  shadow = current;
  try {
    const source = parseShadowSource(input);
    if (!openAfterSync && (await listSyncedShadows(shadowRoot())).some(item => item.href === source.href)) {
      shadow = undefined;
      await window.loadURL(origin + "/my/apps");
      return;
    }
    const route = peerRoute ?? await resolveSavedPeer(source);
    current.controller = await openShadowView(window, source, shadowRoot(), shortcuts, {
      getSession: async () => {
        const response = await localPeerFetch(route + "-session", {
          method: "POST", headers: { "x-localapp-desktop-control": deviceControlToken },
        });
        return response;
      },
      openAfterSync,
      onBack: showLibrary => {
        if (shadow === current) shadow = undefined;
        if (window.isDestroyed()) return;
        if (showLibrary) void window.loadURL(origin + "/my/apps").catch(() => {});
        else void refreshMainMenu?.();
      },
    });
  } catch (error) {
    if (shadow === current) shadow = undefined;
    if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: "warning", message: error.message });
  }
}

async function localPeerFetch(route, options) {
  const response = await window.webContents.session.fetch(origin + route, {
    ...options, credentials: "include", redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "无法读取对端配置");
  return result.data;
}

async function resolveSavedPeer(source) {
  const apps = await localPeerFetch("/api/peers");
  const name = source.pathname.split("/").at(-1);
  for (const peer of apps) {
    if (peer.baseUrl !== source.origin || !/^[A-Za-z0-9_-]+$/.test(peer.id)) continue;
    const route = `/api/peers/${peer.id}/apps/${name}/shadow`;
    const result = await localPeerFetch(route).catch(() => null);
    if (result?.url === source.href) return route;
  }
  throw new Error("找不到此影子应用对应的对端与账号");
}

function enqueueActivation(value) {
  if (typeof value !== "string" || !value.startsWith("localapp://")
    || Buffer.byteLength(value) > 4096 || pendingActivations.length >= 8
    || pendingActivations.includes(value)) return;
  pendingActivations.push(value);
  void showNextActivation();
}

async function showNextActivation() {
  if (!windowReady || handlingActivation || quitting) return;
  if (new URL(window.webContents.getURL()).pathname.replace(/\/$/, "") === "/setup") return;
  const url = pendingActivations.shift();
  if (!url) return;
  handlingActivation = true;
  try {
    const confirmation = await resolveDeviceActivation(url, origin, deviceControlToken);
    if (!quitting && !window.isDestroyed()) {
      const view = new URL(confirmation);
      // The packaged static site serves this page without its API-issued trailing slash.
      view.pathname = view.pathname.replace(/\/$/, "");
      pendingConfirmation = view.href;
      shadow?.controller?.close();
      await openPendingConfirmation();
      window.show();
    }
  } catch {
    if (!quitting && !window.isDestroyed()) {
      await dialog.showMessageBox(window, {
        type: "error", title: "无法打开设备操作",
        message: "请从来源应用重新发起设备操作。",
      });
    }
  } finally {
    handlingActivation = false;
    void showNextActivation();
  }
}

async function openPendingConfirmation() {
  if (!pendingConfirmation || quitting || !window || window.isDestroyed()) return;
  const target = pendingConfirmation;
  await window.loadURL(target);
  if (window.webContents.getURL() === target) pendingConfirmation = undefined;
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  enqueueActivation(url);
});
for (const arg of process.argv.slice(1)) enqueueActivation(arg);

if (process.env.LOCALAPP_DESKTOP_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOCALAPP_DESKTOP_USER_DATA));
}

async function healthy() {
  try {
    const response = await fetch(origin + "/health", { signal: AbortSignal.timeout(1000), redirect: "error" });
    return response.ok && (await response.json()).status === "ok";
  } catch {
    return false;
  }
}

async function ensureServer() {
  const require = createRequire(import.meta.url);
  const cli = require.resolve("@patodo/localapp/plugins/multiuser").replace(/plugins[/\\]multiuser\.mjs$/, "bin/localapp.mjs");
  const root = path.join(app.getPath("userData"), "localapp");
  let setupUrl;
  let ready = false;
  let failure;
  const node = app.isPackaged
    ? fileURLToPath(new URL(process.platform === "win32" ? "./node-runtime/node.exe" : "./node-runtime/node", import.meta.url))
    : process.env.npm_node_execpath;
  if (!node || !path.isAbsolute(node)) throw new Error("开发模式请用 npm 启动 LocalApp");
  server = spawn(node, [cli, "server", "run", "--host", "127.0.0.1", "--port", "0"], {
    env: {
      ...process.env,
      LISTEN_HOST: "127.0.0.1",
      PUBLIC_URL: "",
      LOCALAPP_DEVICE_CONTROL_TOKEN: deviceControlToken,
      LOCALAPP_DATA_DIR: path.join(root, "data"),
      LOCALAPP_RUNTIME_DIR: path.join(root, "runtime"),
      LOCALAPP_SUPPORT_DIR: path.join(root, "support"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.once("error", error => { failure = error; });
  server.once("exit", code => { failure = new Error(`LocalApp Server 已退出 (${code})`); });
  server.stderr.resume();
  let pending = "";
  server.stdout.setEncoding("utf8").on("data", chunk => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "ready") {
          const listener = new URL(event.listenUrl);
          if (listener.protocol !== "http:" || listener.hostname !== "127.0.0.1" || !listener.port) continue;
          if (event.setupUrl && new URL(event.setupUrl).origin !== listener.origin) continue;
          origin = listener.origin;
          setupUrl = event.setupUrl;
          ready = true;
        }
      } catch {
        // The Server also emits ordinary diagnostic messages.
      }
    }
  });
  for (let tries = 0; tries < 120 && !quitting; tries++) {
    if (failure) throw failure;
    if (ready && await healthy()) return setupUrl ?? origin;
    await delay(250);
  }
  throw new Error("本机 LocalApp Server 未及时就绪");
}

async function openWindow() {
  const url = await ensureServer();
  if (quitting) return;
  window = new BrowserWindow({
    title: "LocalApp",
    width: 1280,
    height: 850,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "persist:localapp-desktop",
      preload: fileURLToPath(new URL("./shadow-preload.cjs", import.meta.url)) },
  });
  const isLocal = url => {
    try { return new URL(url).origin === origin; } catch { return false; }
  };
  window.webContents.setWindowOpenHandler(({ url }) => ({ action: isLocal(url) ? "allow" : "deny" }));
  for (const eventName of ["will-navigate", "will-redirect"]) {
    window.webContents.on(eventName, (event, url) => {
      if (!isLocal(url)) event.preventDefault();
    });
  }
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url)) return;
    const target = new URL(url);
    if (!/^\/api\/peers\/[A-Za-z0-9_-]+\/apps\/[a-z0-9-]+\/shadow$/.test(target.pathname)) return;
    event.preventDefault();
    void (async () => {
      try {
        const result = await localPeerFetch(target.pathname);
        await openShadow(result.url, false, target.pathname);
      } catch (error) {
        if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: "warning", message: error.message });
      }
    })();
  });
  function requireLibrary(event, allowPeers = false) {
    const frame = event.senderFrame;
    if (event.sender !== window.webContents || !frame || frame.parent) throw new Error("Unexpected shadow library caller");
    const url = new URL(frame.url);
    if (url.origin !== origin || !((allowPeers ? /^\/my\/(apps|peers)\/?$/ : /^\/my\/apps\/?$/).test(url.pathname))) throw new Error("Unexpected shadow library page");
  }

  ipcMain.handle("localapp:shadows:list", async event => {
    requireLibrary(event, true);
    return (await listSyncedShadows(shadowRoot())).map(source => {
      const [owner, name] = source.pathname.slice(1).split("/");
      return { id: source.href, name, owner, host: source.host };
    });
  });
  ipcMain.handle("localapp:shadows:open", async (event, id) => {
    requireLibrary(event);
    const source = (await listSyncedShadows(shadowRoot())).find(item => item.href === id);
    if (!source) throw new Error("影子应用不存在");
    await openShadow(source.href, true);
  });
  const buildMenu = (applicationUrl, declarations = []) => Menu.buildFromTemplate([
    { label: "LocalApp", submenu: [
      { label: "当前应用的全局快捷键", enabled: declarations.length > 0, submenu: declarations.map(shortcut => {
        const id = `local:${applicationUrl.pathname}:${shortcut.id}`;
        return {
          label: `${shortcut.label} · ${shortcut.accelerator}`,
          type: "checkbox",
          checked: shortcuts.isEnabled(id),
          click: async item => {
            if (!item.checked) shortcuts.disable(id);
            else item.checked = await shortcuts.enable(window, { ...shortcut, id, onDisabled: () => {
              if (window.isFocused()) void refreshMenu();
            }, run: () => {
              shadow?.controller?.close();
              window.show();
              window.focus();
              void window.loadURL(applicationUrl.origin + applicationUrl.pathname + shortcut.route).catch(() => {});
            } });
          },
        };
      }) },
      { label: "打开首页", click: () => { void window.loadURL(origin).catch(() => {}); } },
      { label: "打开待确认设备操作", click: () => {
        if (pendingConfirmation) void openPendingConfirmation().catch(() => {});
        else void window.loadURL(origin + "/my/device-actions").catch(() => {});
      } },
      { label: "重新打开初始化", enabled: new URL(url).pathname === "/setup", click: () => {
        app.relaunch();
        app.quit();
      } },
      { role: "quit", label: "退出 LocalApp" },
    ] },
    { role: "editMenu" },
  ]);
  async function refreshMenu() {
    if (quitting || shadow || window.isDestroyed() || !window.isFocused()) return;
    const current = window.webContents.getURL();
    if (!current || !isLocal(current)) return;
    const target = new URL(current);
    let declarations = [];
    if (/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(target.pathname)) {
      target.pathname = target.pathname.replace(/\/$/, "");
      try {
        const response = await window.webContents.session.fetch(origin + "/api/shadow" + target.pathname + "/frontend", {
          credentials: "include", redirect: "error", signal: AbortSignal.timeout(3000),
        });
        if (response.ok) declarations = readShortcutDeclarations(await response.json());
      } catch {}
    }
    if (!quitting && !shadow && !window.isDestroyed() && window.isFocused() && current === window.webContents.getURL()) {
      const menu = buildMenu(target, declarations);
      if (process.platform === "darwin") Menu.setApplicationMenu(menu);
      else window.setMenu(menu);
    }
  }
  refreshMainMenu = refreshMenu;
  Menu.setApplicationMenu(buildMenu());
  window.on("focus", () => { void refreshMenu(); });
  window.webContents.on("did-navigate", () => { void refreshMenu(); });
  window.webContents.on("did-finish-load", () => { void showNextActivation(); });
  await window.loadURL(url);
  windowReady = true;
  void showNextActivation();
  console.log(`LocalApp 窗口已加载 ${new URL(window.webContents.getURL()).pathname}`);
  if (process.argv.includes("--smoke-test")) app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, args) => {
    for (const arg of args) enqueueActivation(arg);
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("before-quit", event => {
    quitting = true;
    shortcuts.clear();
    if (stopped || !server?.pid || server.exitCode !== null || server.signalCode !== null) return;
    event.preventDefault();
    const child = server;
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      stopped = true;
      app.quit();
    });
    child.kill("SIGTERM");
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    if (process.platform === "win32" && app.isPackaged && !app.isDefaultProtocolClient("localapp")) {
      if (!app.setAsDefaultProtocolClient("localapp")) console.error("无法注册 LocalApp 设备操作协议");
    }
    await openWindow();
  }).catch(error => {
    dialog.showErrorBox("无法启动 LocalApp", error.message);
    app.quit();
  });
}
