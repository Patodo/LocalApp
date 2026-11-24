import { Menu, WebContentsView, session } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
const platformAssetPath = /^\/_next\/static\/(?:chunks|css)\/(?:[^?#]*[./-])?[a-f0-9]{8,}\.(?:js|css)$/;

function fetchPlatformAsset(url, signal) {
  return session.fromPartition("persist:shadow-platform-assets").fetch(url, {
    signal, redirect: "error", credentials: "omit", cache: "force-cache",
  });
}

async function warmPlatformAssets(source, fetchEntry) {
  const signal = AbortSignal.timeout(15_000);
  const entry = await fetchEntry(source.href + "/", { signal });
  if (!entry.ok) return;
  const html = await entry.text();
  const assets = new Set();
  for (const [, relative] of html.matchAll(/\b(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    const url = new URL(relative, source.origin);
    if (!platformAssetPath.test(url.pathname) || url.search) continue;
    assets.add(url.href);
    if (assets.size >= 32) break;
  }
  await Promise.allSettled([...assets].map(async url => {
    const response = await fetchPlatformAsset(url, signal);
    await response.arrayBuffer();
  }));
}

const assetPath = /^(?!api(?:\/|$))(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export async function listSyncedShadows(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sources = await Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).map(async entry => {
    try {
      const source = parseShadowSource(await readFile(path.join(root, entry.name, "source"), "utf8"));
      return hash(source.href) === entry.name ? source : null;
    } catch {
      return null;
    }
  }));
  return sources.filter(Boolean).sort((a, b) => a.href.localeCompare(b.href));
}

async function loadFrontend(directory, release, baseUrl, fetchRemote, signal) {
  if (!/^[a-f0-9]{64}$/.test(release.digest) || !Array.isArray(release.files) || release.files.length > 2000) {
    throw new Error("无效的前端文件清单");
  }
  const next = new Map();
  let total = 0;
  for (const asset of release.files) {
    signal.throwIfAborted();
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
      const download = await fetchRemote(baseUrl + asset.path, {
        redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: "include",
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
  return next;
}

export async function addSyncedShadow(source, root, getSession) {
  const directory = path.join(root, hash(source.href));
  const signal = AbortSignal.timeout(60_000);
  const ticket = (await getSession())?.ticket;
  if (typeof ticket !== "string" || !ticket) throw new Error("无效的影子会话");
  const fetchRemote = (url, options) => session.defaultSession.fetch(url, {
    ...options, credentials: "omit", redirect: "error", cache: "no-store",
    headers: { "x-localapp-shadow-session": ticket },
  });
  const response = await fetchRemote(source.origin + `/api/shadow${source.pathname}/frontend`, { signal });
  if (!response.ok) throw new Error("无法读取远端应用版本，请检查对端 API Key 和应用权限。");
  await mkdir(directory, { recursive: true });
  await loadFrontend(directory, await response.json(), source.origin + `/serve${source.pathname}/`, fetchRemote, signal);
  await writeFile(path.join(directory, "source"), source.href, { mode: 0o600 });
  void warmPlatformAssets(source, fetchRemote).catch(() => {});
}

export async function openShadowView(shell, source, root, shortcuts, { openAfterSync = false, getSession, onBack }) {
  const key = hash(source.href);
  const directory = path.join(root, key);
  await mkdir(directory, { recursive: true });
  if (shell.isDestroyed()) throw new Error("LocalApp 窗口已关闭");
  const partition = session.fromPartition(`shadow-${key}`);
  const statusView = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const view = new WebContentsView({
    webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  shell.contentView.addChildView(view);
  shell.contentView.addChildView(statusView);
  let toolbar = false;
  const resize = () => {
    const [width, height] = shell.getContentSize();
    const top = toolbar ? 48 : 0;
    view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    statusView.setBounds({ x: 0, y: 0, width, height: toolbar ? top : height });
  };
  shell.on("resize", resize);
  resize();

  const files = new Map();
  const enabled = new Set();
  const prefix = `/serve${source.pathname}/`;
  let identity;
  const manifestPath = `/api/shadow${source.pathname}/frontend`;
  const metadataPath = `/api/pages${source.pathname}/meta`;
  const fetchRemote = (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(typeof input === "string" ? undefined : input.headers);
    headers.delete("x-localapp-shadow-session");
    if (identity && url.origin === source.origin && (
      [source.pathname, manifestPath, metadataPath, "/api/me", prefix.slice(0, -1)].includes(url.pathname)
      || url.pathname === source.pathname + "/" || url.pathname.startsWith(prefix)
    )) headers.set("x-localapp-shadow-session", identity.ticket);
    return partition.fetch(input, {
      ...options, headers: new Headers([...headers, ...new Headers(options?.headers)]),
      bypassCustomProtocolHandlers: true, cache: "no-store",
    });
  };
  let updating = false;
  let closed = false;
  let showingApp = false;
  let opened = openAfterSync;
  let ready = false;
  let opening = false;
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
    if (url.origin === source.origin && request.method === "GET" && !url.search && platformAssetPath.test(url.pathname)) {
      return fetchPlatformAsset(url.href, request.signal).catch(() => new Response(null, { status: 503 }));
    }
    const relative = url.pathname.slice(prefix.length) || "index.html";
    const cached = url.origin === source.origin && request.method === "GET"
      && url.pathname.startsWith(prefix) && files.get(relative);
    if (cached) return new Response(cached.bytes, { headers: {
      "content-type": cached.type, "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    } });
    return fetchRemote(request, { redirect: "manual" }).catch(() => {
      if (showingApp && url.origin === source.origin && url.pathname.startsWith(prefix + "api/")) {
        void showStatus("连接已中断", "恢复连接后可以继续使用。", "retry");
      }
      return new Response(null, { status: 503 });
    });
  });

  const actions = {
    open: "打开应用",
    retry: "重新同步",
    library: "查看我的应用",
  };
  const actionOrigin = "https://shadow-action.invalid";
  const back = `<a class="back" href="${actionOrigin}/back">返回 LocalApp</a>`;
  const appLabel = source.pathname.slice(1);
  const loadStatus = html => statusView.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch(() => {});

  async function showToolbar() {
    toolbar = true;
    resize();
    await loadStatus(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>影子应用</title>
      <style>:root{color-scheme:light dark;font:14px system-ui,sans-serif}
      body{margin:0;display:flex;align-items:center;gap:16px;height:47px;padding:0 16px;border-bottom:1px solid color-mix(in srgb,CanvasText 15%,transparent)}
      a{color:inherit;text-decoration:underline;text-underline-offset:3px} span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
      ${back}<span>${appLabel} · 影子应用</span></html>`);
  }

  const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  async function showStatus(title, detail, action) {
    if (closed) return;
    showingApp = false;
    view.setVisible(false);
    toolbar = false;
    resize();
    const link = action ? `<a class="action" href="${actionOrigin}/${action}">${actions[action]}</a>` : "";
    await loadStatus(
      `<!doctype html><html lang="zh"><meta charset="utf-8"><title>LocalApp</title>
       <style>
         :root { color-scheme: light dark; font: 15px system-ui, sans-serif; }
         body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
         main { max-width: 28rem; padding: 2rem; text-align: center; }
         h1 { font-size: 22px; margin: 0 0 8px; }
         p { opacity: .72; margin: 0; }
         .action { display: inline-block; margin-top: 20px; padding: 8px 18px;
           border-radius: 8px; background: #2563eb; color: white; text-decoration: none; }
         .back { position: absolute; top: 16px; left: 16px; color: inherit; }
         .action:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
       </style>
       ${back}<main><div role="status"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div>${link}</main></html>`);
  }

  async function loadRemote(url) {
    let timer;
    try {
      await Promise.race([
        view.webContents.loadURL(url),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            if (!closed && !showingApp) view.webContents.stop();
            reject(new Error("Remote page load timed out"));
          }, 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function showApplication() {
    if (showingApp || closed || opening || !opened || !ready) return;
    opening = true;
    try {
      await showStatus("正在打开应用", "正在加载远端页面。");
      const showPage = async () => {
        if (closed) return;
        await showToolbar();
        if (closed) return;
        view.setVisible(true);
        view.webContents.focus();
        showingApp = true;
      };
      let visible;
      const onReady = () => { visible = showPage(); };
      view.webContents.once("dom-ready", onReady);
      try {
        await loadRemote(source.href + "/");
        await (visible ?? showPage());
      } finally {
        view.webContents.removeListener("dom-ready", onReady);
        await visible;
      }
    } catch {
      if (showingApp) return;
      opened = false;
      await showStatus("应用打开失败", "前端已同步，可以再次尝试打开。", "open");
    } finally {
      opening = false;
    }
  }

  function retry() {
    if (closed || updating || opening) return;
    showingApp = false;
    void update();
  }

  statusView.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url === actionOrigin + "/back") close();
    else if (url === actionOrigin + "/library") close("library");
    else if (url === actionOrigin + "/open" && ready && !updating) {
      opened = true;
      void showApplication();
    } else if (url === actionOrigin + "/retry") retry();
  });
  statusView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  async function finishSync() {
    await writeFile(path.join(directory, "source"), source.href, { mode: 0o600 });
    if (closed) return;
    ready = true;
    if (opened) await showApplication();
    else await showStatus("已添加影子应用", "在「我的应用」中打开。", "library");
  }

  async function update() {
    if (closed || updating || opening) return;
    updating = true;
    const timeout = AbortSignal.timeout(60_000);
    if (!showingApp && !ready) await showStatus("正在同步应用", "正在检查远端版本。");
    try {
      if (!identity || identity.expiresAt - Date.now() < 60_000) {
        const session = await getSession();
        if (!session || typeof session.ticket !== "string" || !Number.isSafeInteger(session.expiresIn)
          || session.expiresIn <= 0 || session.expiresIn > 15 * 60_000) throw new Error("无效的影子会话");
        identity = { ticket: session.ticket, expiresAt: Date.now() + session.expiresIn };
      }
      const response = await fetchRemote(source.origin + manifestPath, {
        redirect: "error", signal: AbortSignal.any([timeout, AbortSignal.timeout(8000)]), credentials: "include",
        headers: fingerprint ? { "If-None-Match": `"${fingerprint}"` } : undefined,
      });
      if (response.status === 401 || response.status === 403) {
        identity = undefined;
        files.clear();
        fingerprint = undefined;
        ready = false;
        await showStatus("对端身份验证失败", "请检查对端 API Key 后重新同步。", "retry");
        return;
      }
      if (response.status === 304 && fingerprint) {
        if (!ready || (opened && !showingApp)) await finishSync();
        return;
      }
      if (!response.ok) {
        ready = false;
        await showStatus("无法读取远端应用版本", "请确认远端应用仍可访问，再重新同步。", "retry");
        return;
      }
      const release = await response.json();
      if (!/^[a-f0-9]{64}$/.test(release.digest) || !Array.isArray(release.files) || release.files.length > 2000) {
        throw new Error("Invalid release");
      }
      if (release.digest !== fingerprint) {
        ready = false;
        await showStatus("正在同步应用", "正在下载并校验前端文件。");
        const nextDeclarations = readShortcutDeclarations(release);
        const next = await loadFrontend(directory, release, source.origin + prefix, fetchRemote, timeout);
        if (closed) return;
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
      if (!ready || (opened && !showingApp)) await finishSync();
    } catch (error) {
      ready = false;
      await showStatus(timeout.aborted ? "同步超时" : "同步失败", error.message || "未能准备远端应用。", "retry");
    } finally {
      updating = false;
    }
  }

  function attachMenu() {
    menu = Menu.buildFromTemplate([{ label: "影子应用", submenu: [
      { label: "重新连接", click: retry },
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
      { label: "返回 LocalApp", click: close },
      { role: "quit", label: "退出 LocalApp" },
    ] }]);
    if (process.platform !== "darwin") shell.setMenu(menu);
    else if (shell.isFocused()) Menu.setApplicationMenu(menu);
  }
  const focusMenu = () => { if (process.platform === "darwin" && menu) Menu.setApplicationMenu(menu); };
  shell.on("focus", focusMenu);
  attachMenu();
  view.setVisible(false);
  const timer = setInterval(() => { if (opened) void update(); }, 15000);
  function close(destination) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    for (const id of enabled) shortcuts.disable(id);
    partition.protocol.unhandle("https");
    shell.off("resize", resize);
    shell.off("focus", focusMenu);
    shell.off("closed", close);
    if (!shell.isDestroyed()) {
      shell.contentView.removeChildView(statusView);
      shell.contentView.removeChildView(view);
      shell.webContents.focus();
    }
    if (!statusView.webContents.isDestroyed()) statusView.webContents.close();
    if (!view.webContents.isDestroyed()) view.webContents.close();
    onBack(destination === "library");
  }
  shell.once("closed", close);
  statusView.webContents.focus();
  void update();
  return { close };
}
