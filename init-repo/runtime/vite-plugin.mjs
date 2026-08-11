import react from "@vitejs/plugin-react";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VIRTUAL_ID = "\0virtual:localapp-dev.tsx";
const VIRTUAL_RESOLVE_REQUEST = "/virtual:localapp-dev.tsx";
const DEV_SHELL_OPTIMIZE_DEPS = ["react-markdown", "remark-gfm", "unified", "remark-parse"];
const DEV_CSRF_COOKIE = "localapp_dev_csrf";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function boundedProxyContext(requestPath) {
  const escaped = requestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}(?:/|\\?|$)`;
}

/**
 * 读取项目根的 .localapp/dev-config.json。
 * 缺失或解析失败时返回空对象（dev server 不配 proxy）。
 */
function loadDevConfig(projectRoot) {
  try {
    const configPath = path.resolve(projectRoot, ".localapp/dev-config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 构建注入 X-API-Key header 的 configure 钩子。
 * dev 模式下 vite proxy 默认不传 cookie/credentials，靠 api_key 鉴权。
 */
function buildAuthConfigure(apiKey, devConfig = {}) {
  if (!apiKey && !devConfig.pageName) return undefined;
  return (proxy) => {
    proxy.on("proxyReq", (proxyReq) => {
      if (apiKey) proxyReq.setHeader("X-API-Key", apiKey);
      if (devConfig.pageName) proxyReq.setHeader("X-LocalApp-Dev-Page", devConfig.pageName);
    });
  };
}

function buildDeviceActionConfigure(apiKey, serverUrl, rawAppScope, shellAppScope, devConfig = {}) {
  if (!apiKey && !rawAppScope && !devConfig.pageName) return undefined;
  return (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      if (apiKey) proxyReq.setHeader("X-API-Key", apiKey);
      if (devConfig.pageName) proxyReq.setHeader("X-LocalApp-Dev-Page", devConfig.pageName);
      const requestPath = req.url?.split("?", 1)[0];
      if (rawAppScope && req.method === "POST" && ["/api/device-actions", "/api/desktop-actions"].includes(requestPath)) {
        const query = req.url.slice(requestPath.length);
        const endpoint = requestPath.endsWith("device-actions") ? "device-actions" : "desktop-actions";
        proxyReq.path = `${rawAppScope}/api/${endpoint}${query}`;
        proxyReq.setHeader("Referer", `${new URL(serverUrl).origin}${shellAppScope}/`);
      }
    });
  };
}

function buildDeviceActionProxy(devConfig, serverUrl) {
  const hasAppScope = Boolean(devConfig.userId && devConfig.pageName);
  const encodedApp = hasAppScope
    ? `${encodeURIComponent(devConfig.userId)}/${encodeURIComponent(devConfig.pageName)}`
    : undefined;
  const rawAppScope = encodedApp ? `/serve/${encodedApp}` : undefined;
  const shellAppScope = encodedApp ? `/${encodedApp}` : undefined;
  const configure = buildDeviceActionConfigure(
    devConfig.apiKey,
    serverUrl,
    rawAppScope,
    shellAppScope,
    devConfig,
  );
  return {
    target: serverUrl,
    changeOrigin: true,
    ...(configure ? { configure } : {}),
  };
}

/**
 * 根据 dev-config 构建 vite proxy 配置。
 * - 所有 API 都走 canonical Server；页面级 API 重写到 /serve/<userId>/<pageName>/api/*
 * - Device Action 创建请求重写到当前开发应用，能力、状态和事件请求走 Server 全局端点
 * - apiKey 非空时所有转发请求注入 X-API-Key header
 */
export function buildProxy(devConfig, serverUrl) {
  const proxy = {};
  const configure = buildAuthConfigure(devConfig.apiKey, devConfig);

  if (!serverUrl) return undefined;

  const globalEndpoints = [
    "/api/me",
    "/api/users",
    "/api/groups",
    "/api/llm",
    "/api/issues",
    "/api/platform",
  ];
  for (const ep of globalEndpoints) {
    proxy[boundedProxyContext(ep)] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
  }
  proxy[boundedProxyContext("/api/device-actions")] = buildDeviceActionProxy(devConfig, serverUrl);
  proxy[boundedProxyContext("/api/desktop-actions")] = buildDeviceActionProxy(devConfig, serverUrl);
  proxy[boundedProxyContext("/api/dev")] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
  proxy[boundedProxyContext("/serve")] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };

  if (devConfig.userId && devConfig.pageName) {
    const apiPrefix = `/serve/${devConfig.userId}/${devConfig.pageName}/api`;
    proxy["/api"] = {
      target: serverUrl,
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, apiPrefix),
      ...(configure ? { configure } : {}),
    };
  } else {
    proxy["/api"] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
  }

  return { proxy };
}

function requireCanonicalDevConfig(devConfig) {
  const missing = [];
  for (const field of ["serverUrl", "userId", "pageName", "apiKey"]) {
    if (typeof devConfig?.[field] !== "string" || !devConfig[field].trim()) missing.push(field);
  }
  if (!Number.isInteger(devConfig?.appServerPort) || devConfig.appServerPort < 1 || devConfig.appServerPort > 65535) {
    missing.push("appServerPort");
  }
  if (missing.length > 0) {
    throw new Error(
      `localapp: .localapp/dev-config.json is missing required canonical Server fields: ${missing.join(", ")}. Run 'localapp dev' instead of starting Vite directly.`,
    );
  }
  const serverUrlMatch = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(devConfig.serverUrl);
  if (!serverUrlMatch || Number(serverUrlMatch[1]) > 65535) {
    throw new Error(
      "localapp: .localapp/dev-config.json serverUrl must be exact http://127.0.0.1:<nonzero-port> with no credentials, path, query, or fragment. Run 'localapp dev' to regenerate it.",
    );
  }
}

function installDevProxySecurity(server, devConfig, csrfToken) {
  const allowedOrigins = new Set([
    `http://127.0.0.1:${devConfig.appServerPort}`,
    `http://localhost:${devConfig.appServerPort}`,
    `https://127.0.0.1:${devConfig.appServerPort}`,
    `https://localhost:${devConfig.appServerPort}`,
  ]);
  server.middlewares.use((req, res, next) => {
    const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const isCredentialedMutation = UNSAFE_METHODS.has(req.method ?? "GET")
      && (requestPath === "/api" || requestPath.startsWith("/api/") || requestPath === "/serve" || requestPath.startsWith("/serve/"));
    if (isCredentialedMutation) {
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
      const cookies = typeof req.headers.cookie === "string" ? req.headers.cookie.split(";") : [];
      const hasCsrfCookie = cookies.some((cookie) => {
        const [name, value] = cookie.trim().split("=", 2);
        return name === DEV_CSRF_COOKIE && value === csrfToken;
      });
      if (!allowedOrigins.has(origin) || !hasCsrfCookie) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ success: false, error: "LocalApp dev proxy rejected a cross-origin request" }));
        return;
      }
    }
    if (!(req.headers.cookie ?? "").includes(`${DEV_CSRF_COOKIE}=`)) {
      res.setHeader(
        "Set-Cookie",
        `${DEV_CSRF_COOKIE}=${csrfToken}; Path=/; HttpOnly; SameSite=Strict`,
      );
    }
    next();
  });
}

export function buildDevServer(devConfig, userServer = {}) {
  requireCanonicalDevConfig(devConfig);
  const proxyConfig = buildProxy(devConfig, devConfig.serverUrl);
  return {
    ...userServer,
    ...(proxyConfig ?? {}),
    host: "127.0.0.1",
    allowedHosts: ["localhost", "127.0.0.1"],
    ...(Number.isInteger(devConfig.appServerPort)
      ? { port: devConfig.appServerPort, strictPort: true }
      : {}),
  };
}

/**
 * 虚拟模块代码：仅 dev 模式注入。
 * 用户 main.tsx 永远只 render(<App />)，DevShell 由这里挂载。
 */
function buildDevShellVirtualModule() {
  return [
    'import React from "react";',
    'import { createRoot } from "react-dom/client";',
    'import { DevShell } from "@localapp/app-kit/dev-shell";',
    'import "/src/index.css";',
    'import App from "/src/App.tsx";',
    "",
    "createRoot(document.getElementById(\"root\")).render(",
    "  React.createElement(",
    "    React.StrictMode,",
    "    null,",
    "    React.createElement(DevShell, null, React.createElement(App)),",
    "  ),",
    ");",
    "",
  ].join("\n");
}

/**
 * localapp vite plugin：封装 dev proxy、@ alias、react 支持、DevShell 虚拟注入。
 *
 * DevShell 注入：dev 模式下 transformIndexHtml 把 main.tsx 替换为虚拟模块，
 * 虚拟模块导入 DevShell 包裹 App；生产构建时所有钩子 no-op，DevShell 不进入 bundle。
 *
 * 用 .mjs 而不是 .ts 是因为该文件会被 vite.config.ts 直接 import，
 * 经过 Node 加载而非 Vite 编译；Node 26+ 的 type stripping 限制
 * 不覆盖 node_modules 下的 .ts 文件。
 *
 * 用法（用户项目根的 vite.config.ts）：
 * ```ts
 * import { defineConfig } from "vite";
 * import { localapp } from "@localapp/app-kit/vite";
 *
 * export default defineConfig({
 *   plugins: [localapp()],
 * });
 * ```
 *
 * 测试场景下可通过 options.command 显式传入 'serve' 或 'build' 模拟 vite 环境。
 */
export function localapp(options = {}) {
  const projectRoot = process.cwd();
  const devConfig = options.devConfig ?? loadDevConfig(projectRoot);
  const devCsrfToken = options.devCsrfToken ?? randomBytes(32).toString("hex");
  let command = options.command;

  const localappPlugin = {
    name: "localapp-runtime",
    config(userConfig, configEnv) {
      command = command || configEnv?.command;
      const devServer = command === "serve"
        ? buildDevServer(devConfig, userConfig.server)
        : userConfig.server;
      return {
        ...userConfig,
        optimizeDeps: {
          ...userConfig.optimizeDeps,
          include: Array.from(new Set([
            ...(userConfig.optimizeDeps?.include ?? []),
            ...DEV_SHELL_OPTIMIZE_DEPS,
          ])),
        },
        resolve: {
          ...userConfig.resolve,
          alias: {
            ...userConfig.resolve?.alias,
            "@": path.resolve(projectRoot, "./src"),
          },
        },
        ...(devServer ? { server: devServer } : {}),
      };
    },
    transformIndexHtml(html) {
      if (command !== "serve") return html;
      return html.replace(
        /<script([^>]*?)src="\/src\/main\.tsx(?:\?[^"]*)?"[^>]*><\/script>/g,
        `<script type="module" src="${VIRTUAL_RESOLVE_REQUEST}"></script>`,
      );
    },
    buildStart() {
      if (command !== "serve") return;
      const appPath = path.resolve(projectRoot, "src/App.tsx");
      if (!fs.existsSync(appPath)) {
        console.error(
          `localapp: src/App.tsx not found. The dev shell assumes App at src/App.tsx.`,
        );
      }
    },
    configureServer(server) {
      installDevProxySecurity(server, devConfig, devCsrfToken);
    },
    resolveId(id) {
      if (command !== "serve") return null;
      if (id === VIRTUAL_RESOLVE_REQUEST) return VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (command !== "serve") return null;
      if (id === VIRTUAL_ID) return buildDevShellVirtualModule();
      return null;
    },
  };

  return [react(), localappPlugin];
}
