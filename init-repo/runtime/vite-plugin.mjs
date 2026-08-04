import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const VIRTUAL_ID = "\0virtual:localapp-dev.tsx";
const VIRTUAL_RESOLVE_REQUEST = "/virtual:localapp-dev.tsx";
const DEV_SHELL_OPTIMIZE_DEPS = ["react-markdown", "remark-gfm", "unified", "remark-parse"];

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
function buildAuthConfigure(apiKey) {
  if (!apiKey) return undefined;
  return (proxy) => {
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader("X-API-Key", apiKey);
    });
  };
}

function buildDesktopActionConfigure(apiKey, serverUrl, rawAppScope, shellAppScope) {
  if (!apiKey && !rawAppScope) return undefined;
  return (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      if (apiKey) proxyReq.setHeader("X-API-Key", apiKey);
      const requestPath = req.url?.split("?", 1)[0];
      if (rawAppScope && req.method === "POST" && requestPath === "/api/desktop-actions") {
        const query = req.url.slice(requestPath.length);
        proxyReq.path = `${rawAppScope}/api/desktop-actions${query}`;
        proxyReq.setHeader("Referer", `${new URL(serverUrl).origin}${shellAppScope}/`);
      }
    });
  };
}

function buildDesktopActionProxy(devConfig, serverUrl) {
  const hasAppScope = Boolean(devConfig.userId && devConfig.pageName);
  const encodedApp = hasAppScope
    ? `${encodeURIComponent(devConfig.userId)}/${encodeURIComponent(devConfig.pageName)}`
    : undefined;
  const rawAppScope = encodedApp ? `/serve/${encodedApp}` : undefined;
  const shellAppScope = encodedApp ? `/${encodedApp}` : undefined;
  const configure = buildDesktopActionConfigure(
    devConfig.apiKey,
    serverUrl,
    rawAppScope,
    shellAppScope,
  );
  return {
    target: serverUrl,
    changeOrigin: true,
    ...(configure ? { configure } : {}),
  };
}

/**
 * 根据 dev-config 构建 vite proxy 配置。
 * - miniServerPort 存在时，平台 LLM/桌面动作端点走 serverUrl，普通 /api/* 走 mini-server
 * - miniServerPort 缺失时保留旧行为：全局端点走 serverUrl，页面级 API 重写到 /serve/<userId>/<pageName>/api/*
 * - apiKey 非空时所有转发请求注入 X-API-Key header
 */
export function buildProxy(devConfig, serverUrl) {
  const proxy = {};
  const configure = buildAuthConfigure(devConfig.apiKey);

  if (devConfig.miniServerPort) {
    const miniServerUrl = `http://127.0.0.1:${devConfig.miniServerPort}`;
    if (serverUrl) {
      proxy["/api/llm"] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
      proxy["/api/desktop-actions"] = buildDesktopActionProxy(devConfig, serverUrl);
    }
    proxy["/api"] = { target: miniServerUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
    return { proxy };
  }

  if (!serverUrl) return undefined;

  console.warn("localapp: dev-config.json has no miniServerPort; falling back to legacy serverUrl proxy.");

  const globalEndpoints = ["/api/me", "/api/users", "/api/groups", "/api/llm"];
  for (const ep of globalEndpoints) {
    proxy[ep] = { target: serverUrl, changeOrigin: true, ...(configure ? { configure } : {}) };
  }
  proxy["/api/desktop-actions"] = buildDesktopActionProxy(devConfig, serverUrl);

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

export function buildDevServer(devConfig, userServer = {}) {
  const proxyConfig = buildProxy(devConfig, devConfig.serverUrl);
  return {
    ...userServer,
    ...(proxyConfig ?? {}),
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
  const devConfig = loadDevConfig(projectRoot);
  let command = options.command;

  const localappPlugin = {
    name: "localapp-runtime",
    config(userConfig, configEnv) {
      command = command || configEnv?.command;
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
        server: buildDevServer(devConfig, userConfig.server),
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
