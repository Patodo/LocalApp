import { BrowserWindow, Menu, WebContentsView, session } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readShortcutDeclarations } from "./shortcuts.mjs";

export function parseShadowSource(input) {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error("请输入 HTTPS 应用地址，例如 https://example.com/owner/app");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const assetPath = /^(?!api(?:\/|$))(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export async function openShadowWindow(source, root, shortcuts) {
  const key = hash(source.href);
  const directory = path.join(root, key);
  await mkdir(directory, { recursive: true });
  const partition = session.fromPartition(`shadow-${key}`, { cache: false });
  const shell = new BrowserWindow({
    title: `LocalApp · ${source.pathname.split("/").at(-1)}`, width: 1200, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const view = new WebContentsView({
    webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  shell.contentView.addChildView(view);
  const resize = () => {
    const [width, height] = shell.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  shell.on("resize", resize);
  resize();

  const files = new Map();
  const enabled = new Set();
  const prefix = `/serve${source.pathname}/`;
  const fetchRemote = (input, options) => partition.fetch(input, {
    ...options, bypassCustomProtocolHandlers: true, cache: "no-store",
  });
  let updating = false;
  let closed = false;
  let showingApp = false;
  let signingIn = false;
  let menu;
  let fingerprint;
  let declarations = [];
  const checkNavigation = (event, value) => {
    if (new URL(value).origin !== source.origin) event.preventDefault();
  };
  view.webContents.on("will-navigate", checkNavigation);
  view.webContents.on("will-redirect", checkNavigation);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  partition.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  partition.protocol.handle("https", request => {
    const url = new URL(request.url);
    const relative = url.pathname.slice(prefix.length) || "index.html";
    const cached = url.origin === source.origin && request.method === "GET"
      && url.pathname.startsWith(prefix) && files.get(relative);
    if (cached) return new Response(cached.bytes, { headers: {
      "content-type": cached.type, "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    } });
    return fetchRemote(request, { redirect: "manual" }).catch(() => {
      if (showingApp && url.origin === source.origin && url.pathname.startsWith(prefix + "api/")) {
        void showStatus("暂时无法连接远端应用");
      }
      return new Response(null, { status: 503 });
    });
  });

  async function showStatus(message, login = false) {
    if (closed) return;
    showingApp = false;
    view.setVisible(false);
    await shell.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      `<!doctype html><html lang="zh"><meta charset="utf-8"><title>LocalApp</title>
       <body style="font:16px system-ui;display:grid;place-items:center;height:95vh">
       <main><h2>${message}</h2><p>请从 LocalApp 菜单${login ? "登录后" : "检查网络后"}重试。</p></main></body></html>`)).catch(() => {});
  }

  async function showApplication() {
    if (showingApp || closed) return;
    await view.webContents.loadURL(source.href);
    if (closed) return;
    view.setVisible(true);
    showingApp = true;
  }

  async function update() {
    if (closed || updating || signingIn) return;
    updating = true;
    try {
      const response = await fetchRemote(`${source.origin}/api/shadow${source.pathname}/frontend`, {
        redirect: "error", signal: AbortSignal.timeout(8000), credentials: "include",
        headers: fingerprint ? { "If-None-Match": `"${fingerprint}"` } : undefined,
      });
      if (response.status === 401 || response.status === 403) {
        files.clear();
        fingerprint = undefined;
        await showStatus("需要登录远端应用", true);
        return;
      }
      if (response.status === 304 && fingerprint) {
        await showApplication();
        return;
      }
      if (!response.ok) {
        await showStatus(response.status === 404 ? "远端应用不可用或尚未支持影子模式" : "无法读取远端应用版本");
        return;
      }
      const release = await response.json();
      if (!/^[a-f0-9]{64}$/.test(release.digest) || !Array.isArray(release.files) || release.files.length > 2000) {
        throw new Error("Invalid release");
      }
      if (release.digest !== fingerprint) {
        const nextDeclarations = readShortcutDeclarations(release);
        const next = new Map();
        let total = 0;
        for (const asset of release.files) {
          if (!assetPath.test(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256)
            || !Number.isSafeInteger(asset.size) || asset.size < 0 || (total += asset.size) > 100_000_000) {
            throw new Error("Invalid frontend asset");
          }
          const filename = path.join(directory, asset.sha256);
          let entry;
          try {
            const stored = await readFile(filename);
            const saved = JSON.parse(stored.subarray(0, stored.indexOf(10)).toString());
            const bytes = stored.subarray(stored.indexOf(10) + 1);
            if (hash(bytes) === asset.sha256 && bytes.length === asset.size) entry = { bytes, type: saved.type };
          } catch {}
          if (!entry) {
            const download = await fetchRemote(source.origin + prefix + asset.path, {
              redirect: "error", signal: AbortSignal.timeout(20000), credentials: "include",
            });
            if (!download.ok) throw new Error("Frontend download failed");
            const bytes = Buffer.from(await download.arrayBuffer());
            if (bytes.length !== asset.size || hash(bytes) !== asset.sha256) throw new Error("Frontend checksum mismatch");
            entry = { bytes, type: download.headers.get("content-type") || "application/octet-stream" };
            await writeFile(filename + ".partial", Buffer.concat([Buffer.from(JSON.stringify({ type: entry.type }) + "\n"), bytes]), { mode: 0o600 });
            await rename(filename + ".partial", filename);
          }
          next.set(asset.path, entry);
        }
        if (!next.has("index.html")) throw new Error("Frontend index missing");
        for (const previous of declarations) {
          const next = nextDeclarations.find(item => item.id === previous.id);
          if (next?.accelerator === previous.accelerator && next?.route === previous.route) continue;
          const id = `${key}:${previous.id}`;
          shortcuts.disable(id);
          enabled.delete(id);
        }
        declarations = nextDeclarations;
        files.clear();
        for (const [name, entry] of next) files.set(name, entry);
        fingerprint = release.digest;
        attachMenu();
        showingApp = false;
      }
      await showApplication();
    } catch {
      await showStatus("暂时无法连接远端应用");
    } finally {
      updating = false;
    }
  }

  function attachMenu() {
    menu = Menu.buildFromTemplate([{ label: "影子应用", submenu: [
      { label: "登录远端", click: async () => {
        if (closed) return;
        signingIn = true;
        try {
          await view.webContents.loadURL(source.origin);
          if (!closed) view.setVisible(true);
        } catch {
          signingIn = false;
          await showStatus("无法打开远端登录页");
        }
      } },
      { label: "重新连接", click: () => { signingIn = false; showingApp = false; void update(); } },
      { label: "全局快捷键", submenu: declarations.map(shortcut => ({
        label: `${shortcut.label} · ${shortcut.accelerator}`, type: "checkbox",
        checked: shortcuts.isEnabled(`${key}:${shortcut.id}`),
        click: async item => {
          const id = `${key}:${shortcut.id}`;
          if (!item.checked) {
            shortcuts.disable(id);
            enabled.delete(id);
            return;
          }
          item.checked = await shortcuts.enable(shell, { ...shortcut, id, onDisabled: () => {
            enabled.delete(id);
            attachMenu();
          }, run: () => {
            shell.show();
            shell.focus();
            if (showingApp) void view.webContents.loadURL(source.href + shortcut.route).catch(() => {});
          } });
          if (item.checked) enabled.add(id);
        },
      })) },
      { role: "close", label: "关闭影子应用" },
    ] }]);
    if (process.platform !== "darwin") shell.setMenu(menu);
    else if (shell.isFocused()) Menu.setApplicationMenu(menu);
  }
  shell.on("focus", () => { if (process.platform === "darwin" && menu) Menu.setApplicationMenu(menu); });
  attachMenu();
  await showStatus("正在连接远端应用");
  const timer = setInterval(() => { void update(); }, 15000);
  shell.once("closed", () => {
    closed = true;
    clearInterval(timer);
    for (const id of enabled) shortcuts.disable(id);
    partition.protocol.unhandle("https");
    view.webContents.close();
  });
  void update();
  return shell;
}
