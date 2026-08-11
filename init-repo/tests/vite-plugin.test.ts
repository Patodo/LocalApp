// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-ignore - .mjs file has no type declarations
import { buildDevServer, buildProxy, localapp } from "../runtime/vite-plugin.mjs";

type VitePlugin = {
  name: string;
  transformIndexHtml?: (html: string) => string | null | undefined;
  resolveId?: (id: string) => string | null | undefined;
  load?: (id: string) => string | null | undefined;
  buildStart?: { call: (ctx: unknown) => void } | (() => void);
  config?: (userConfig: any, env?: { command?: string }) => any;
};

const TEST_DEV_CONFIG = {
  serverUrl: "http://127.0.0.1:43127",
  apiKey: "test-key",
  userId: "testuser",
  pageName: "demo",
  appServerPort: 5182,
};

function getLocalAppworkPlugin(options: { command?: "serve" | "build"; devConfig?: Record<string, unknown> } = {}): VitePlugin {
  // @ts-ignore - localapp accepts vite UserConfig-style options
  const plugins = localapp({ ...options, devConfig: options.devConfig ?? TEST_DEV_CONFIG });
  return plugins.find((p: VitePlugin) => p.name === "localapp-runtime");
}

function applyProxyRequest(proxyConfig: any, method: string, url: string) {
  let proxyRequestHandler: ((proxyReq: any, req: any) => void) | undefined;
  proxyConfig.configure({
    on: (event: string, handler: (proxyReq: any, req: any) => void) => {
      if (event === "proxyReq") proxyRequestHandler = handler;
    },
  });

  const headers = new Map<string, string>();
  const proxyReq = {
    path: url,
    setHeader: (name: string, value: string) => headers.set(name, value),
  };
  proxyRequestHandler!(proxyReq, { method, url });
  return { headers, path: proxyReq.path };
}

function matchingProxy(config: any, requestPath: string) {
  for (const [context, proxyConfig] of Object.entries(config.proxy)) {
    const matches = context.startsWith("^")
      ? new RegExp(context).test(requestPath)
      : requestPath.startsWith(context);
    if (matches) return proxyConfig as any;
  }
  throw new Error(`No proxy matched ${requestPath}`);
}

function matchingProxyIndex(config: any, requestPath: string) {
  return Object.keys(config.proxy).findIndex((context) => (
    context.startsWith("^")
      ? new RegExp(context).test(requestPath)
      : requestPath.startsWith(context)
  ));
}

describe("vite-plugin DevShell virtual module injection", () => {
  describe("transformIndexHtml hook", () => {
    it("exists when command=serve", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      expect(qplugin).toBeDefined();
      expect(typeof qplugin.transformIndexHtml).toBe("function");
    });

    it("replaces main.tsx script with the virtual module in dev", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const html = `<script type="module" crossorigin src="/src/main.tsx"></script>`;
      const result = qplugin.transformIndexHtml!(html);
      expect(result).toContain("/virtual:localapp-dev.tsx");
      expect(result).not.toContain('src="/src/main.tsx"');
    });

    it("replaces main.tsx script with query string in dev", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const html = `<script type="module" crossorigin src="/src/main.tsx?t=1781618087021"></script>`;
      const result = qplugin.transformIndexHtml!(html);
      expect(result).toContain("/virtual:localapp-dev.tsx");
      expect(result).not.toContain('src="/src/main.tsx?t=');
    });

    it("reads serve command from Vite config hook before injection", () => {
      const qplugin = getLocalAppworkPlugin();
      qplugin.config?.({}, { command: "serve" });
      const html = `<script type="module" crossorigin src="/src/main.tsx"></script>`;
      const result = qplugin.transformIndexHtml!(html);
      expect(result).toContain("/virtual:localapp-dev.tsx");
      expect(result).not.toContain('src="/src/main.tsx"');
    });

    it("does not modify html in build mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "build" });
      const html = `<script type="module" crossorigin src="/src/main.tsx"></script>`;
      const result = qplugin.transformIndexHtml!(html);
      expect(result).toBe(html);
    });

    it("does not inject dev-only markers in build mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "build" });
      const html = `<script type="module" crossorigin src="/src/main.tsx"></script>`;
      const result = qplugin.transformIndexHtml!(html);
      const devOnlyMarkers = [
        "localapp-dev-shell",
        "localapp:dev-context-changed",
        "/api/dev/context",
        "/api/dev/data",
        "/api/dev/diagnostics",
        "/api/dev/business",
        "iframe",
        "sandbox",
      ];

      for (const marker of devOnlyMarkers) {
        expect(result).not.toContain(marker);
      }
    });
  });

  describe("resolveId hook", () => {
    it("resolves the TSX virtual module in serve mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const resolved = qplugin.resolveId!("/virtual:localapp-dev.tsx");
      expect(resolved).toBe("\0virtual:localapp-dev.tsx");
    });

    it("returns null for non-virtual modules", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const resolved = qplugin.resolveId!("/src/main.tsx");
      expect(resolved).toBeNull();
    });

    it("does not resolve the DevShell virtual module in build mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "build" });
      expect(qplugin.resolveId!("/virtual:localapp-dev.tsx")).toBeNull();
    });
  });

  describe("load hook", () => {
    it("returns native DevShell virtual module source in serve mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const code = qplugin.load!("\0virtual:localapp-dev.tsx");
      expect(code).toContain('import { DevShell } from "@localapp/app-kit/dev-shell"');
      expect(code).toContain('import "/src/index.css";');
      expect(code).toContain('import App from "/src/App.tsx"');
      expect(code).toContain("createRoot");
      expect(code).toContain("React.createElement(DevShell");
      expect(code).toContain("React.createElement(App");
      expect(code).not.toContain("<DevShell>");
      expect(code).not.toContain("<App />");
      expect(code).not.toContain("iframe");
      expect(code).not.toContain("sandbox");
    });

    it("returns null for non-virtual module IDs", () => {
      const qplugin = getLocalAppworkPlugin({ command: "serve" });
      const code = qplugin.load!("/src/main.tsx");
      expect(code).toBeNull();
    });

    it("does not load DevShell virtual module source in build mode", () => {
      const qplugin = getLocalAppworkPlugin({ command: "build" });
      const code = qplugin.load!("\0virtual:localapp-dev.tsx");
      expect(code).toBeNull();
    });
  });
});

describe("vite-plugin App path checks", () => {
  it("has buildStart hook in serve mode", () => {
    const qplugin = getLocalAppworkPlugin({ command: "serve" });
    expect(typeof qplugin.buildStart).toBe("function");
  });

  it("does not throw from buildStart when src/App.tsx exists", () => {
    const qplugin = getLocalAppworkPlugin({ command: "serve" });
    expect(() => qplugin.buildStart!.call({})).not.toThrow();
  });
});

describe("vite-plugin dev auth injection", () => {
  it("loads plugin config when dev-config contains apiKey", () => {
    const qplugin = getLocalAppworkPlugin({ command: "serve" });
    expect(qplugin).toBeDefined();
    expect(typeof qplugin.config).toBe("function");
  });

  it("buildProxy source contains apiKey configure hook", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../runtime/vite-plugin.mjs"), "utf-8");
    expect(src).toContain("buildAuthConfigure");
    expect(src).toContain('proxyReq.setHeader("X-API-Key"');
    expect(src).toContain("devConfig.apiKey");
  });

  it("buildAuthConfigure returns undefined when auth and dev context are both absent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../runtime/vite-plugin.mjs"), "utf-8");
    expect(src).toMatch(/if\s*\(\s*!apiKey\s*&&\s*!devConfig\.pageName\s*\)\s*return\s+undefined/);
  });
});

describe("vite-plugin canonical Server routing", () => {
  it("routes ordinary APIs and Device Action endpoints to the same local Server", () => {
    const config = buildProxy(
      {
        serverUrl: "http://127.0.0.1:43127",
        apiKey: "test-key",
        userId: "testuser",
        pageName: "demo",
      },
      "http://127.0.0.1:43127",
    );

    expect(matchingProxy(config, "/api/device-actions").target).toBe("http://127.0.0.1:43127");
    expect(matchingProxy(config, "/api/desktop-actions").target).toBe("http://127.0.0.1:43127");
    expect(config.proxy["/api"].target).toBe("http://127.0.0.1:43127");
    expect(config.proxy["/api"].rewrite("/api/tasks")).toBe("/serve/testuser/demo/api/tasks");
  });

  it("rewrites only exact POST Device Action creation and adds canonical auth headers", () => {
    const config = buildProxy(
      {
        apiKey: "test-key",
        userId: "testuser",
        pageName: "demo",
      },
      "https://prod.example",
    );
    const deviceActions = matchingProxy(config, "/api/device-actions");

    const create = applyProxyRequest(
      deviceActions,
      "POST",
      "/api/device-actions?source=dev",
    );
    expect(create.path).toBe(
      "/serve/testuser/demo/api/device-actions?source=dev",
    );
    expect(create.headers.get("X-API-Key")).toBe("test-key");
    expect(create.headers.get("Referer")).toBe("https://prod.example/testuser/demo/");

    for (const [method, path] of [
      ["GET", "/api/device-actions"],
      ["POST", "/api/device-actions/"],
      ["GET", "/api/device-actions/capabilities"],
      ["GET", "/api/device-actions/request-1"],
      ["GET", "/api/device-actions/request-1/events"],
      ["PATCH", "/api/device-actions/request-1/status"],
      ["POST", "/api/device-actions/recover"],
    ]) {
      const forwarded = applyProxyRequest(deviceActions, method, path);
      expect(forwarded.path).toBe(path);
      expect(forwarded.headers.get("X-API-Key")).toBe("test-key");
      expect(forwarded.headers.has("Referer")).toBe(false);
    }
  });

  it("routes global APIs and page APIs to one configured Server", () => {
    const config = buildProxy(
      { serverUrl: "http://127.0.0.1:43127", apiKey: "test-key", userId: "testuser", pageName: "demo" },
      "http://127.0.0.1:43127",
    );

    expect(matchingProxy(config, "/api/llm").target).toBe("http://127.0.0.1:43127");
    expect(matchingProxy(config, "/api/issues").target).toBe("http://127.0.0.1:43127");
    expect(matchingProxy(config, "/api/platform").target).toBe("http://127.0.0.1:43127");
    expect(matchingProxy(config, "/api/dev").target).toBe("http://127.0.0.1:43127");
    expect(config.proxy["/api"].target).toBe("http://127.0.0.1:43127");
    expect(config.proxy["/api"].rewrite("/api/tasks")).toBe("/serve/testuser/demo/api/tasks");
    const devContext = applyProxyRequest(matchingProxy(config, "/api/dev/context"), "GET", "/api/dev/context");
    expect(devContext.path).toBe("/api/dev/context");
    expect(devContext.headers.get("X-API-Key")).toBe("test-key");
    expect(devContext.headers.get("X-LocalApp-Dev-Page")).toBe("demo");

    const issues = applyProxyRequest(matchingProxy(config, "/api/issues"), "GET", "/api/issues?pagePath=/testuser/demo/");
    expect(issues.path).toBe("/api/issues?pagePath=/testuser/demo/");
    expect(issues.headers.get("X-API-Key")).toBe("test-key");

    const platformUsers = applyProxyRequest(matchingProxy(config, "/api/platform/users"), "GET", "/api/platform/users");
    expect(platformUsers.path).toBe("/api/platform/users");
    expect(platformUsers.headers.get("X-API-Key")).toBe("test-key");
  });

  it("proxies application resource URLs to the canonical Server with dev auth", () => {
    const config = buildProxy(
      { serverUrl: "http://127.0.0.1:43127", apiKey: "test-key", userId: "testuser", pageName: "demo" },
      "http://127.0.0.1:43127",
    );

    expect(matchingProxy(config, "/serve/testuser/demo/").target).toBe("http://127.0.0.1:43127");
    const content = applyProxyRequest(
      matchingProxy(config, "/serve/testuser/demo/api/content/image-key"),
      "GET",
      "/serve/testuser/demo/api/content/image-key",
    );
    expect(content.path).toBe("/serve/testuser/demo/api/content/image-key");
    expect(content.headers.get("X-API-Key")).toBe("test-key");
    expect(content.headers.get("X-LocalApp-Dev-Page")).toBe("demo");
  });

  it("keeps global exceptions before the page API fallback", () => {
    const config = buildProxy(
      { serverUrl: "http://127.0.0.1:43127", apiKey: "test-key", userId: "testuser", pageName: "demo" },
      "http://127.0.0.1:43127",
    );

    for (const endpoint of [
      "/api/me",
      "/api/users",
      "/api/groups",
      "/api/llm",
      "/api/issues",
      "/api/platform",
      "/api/device-actions",
      "/api/desktop-actions",
    ]) {
      expect(matchingProxyIndex(config, endpoint)).toBeLessThan(Object.keys(config.proxy).indexOf("/api"));
    }
    expect(matchingProxy(config, "/api/messages")).toBe(config.proxy["/api"]);
  });

  it("does not create a local API proxy without a canonical Server URL", () => {
    expect(buildProxy({ serverUrl: "", apiKey: "", userId: "testuser", pageName: "demo" }, "")).toBeUndefined();
  });

  it("keeps Device Action creation before the page API fallback", () => {
    const config = buildProxy(
      { serverUrl: "https://prod.example", apiKey: "test-key", userId: "testuser", pageName: "demo" },
      "https://prod.example",
    );

    expect(matchingProxyIndex(config, "/api/device-actions")).toBeLessThan(
      Object.keys(config.proxy).indexOf("/api"),
    );
    expect(matchingProxyIndex(config, "/api/desktop-actions")).toBeLessThan(
      Object.keys(config.proxy).indexOf("/api"),
    );
  });

  it("uses the same exact creation exception for the legacy alias", () => {
    const config = buildProxy(
      {
        apiKey: "legacy-key",
        userId: "owner name",
        pageName: "desktop/app",
      },
      "https://prod.example/base",
    );
    const desktopActions = matchingProxy(config, "/api/desktop-actions");

    const create = applyProxyRequest(desktopActions, "POST", "/api/desktop-actions");
    expect(create.path).toBe(
      "/serve/owner%20name/desktop%2Fapp/api/desktop-actions",
    );
    expect(create.headers.get("X-API-Key")).toBe("legacy-key");
    expect(create.headers.get("Referer")).toBe(
      "https://prod.example/owner%20name/desktop%2Fapp/",
    );

    for (const [method, path] of [
      ["PUT", "/api/desktop-actions"],
      ["GET", "/api/desktop-actions/capabilities"],
      ["GET", "/api/desktop-actions/request-1"],
      ["GET", "/api/desktop-actions/request-1/events"],
      ["PATCH", "/api/desktop-actions/request-1/status"],
      ["POST", "/api/desktop-actions/recover"],
    ]) {
      const forwarded = applyProxyRequest(desktopActions, method, path);
      expect(forwarded.path).toBe(path);
      expect(forwarded.headers.get("X-API-Key")).toBe("legacy-key");
      expect(forwarded.headers.has("Referer")).toBe(false);
    }

    expect(config.proxy["/api"].rewrite("/api/tasks")).toBe(
      "/serve/owner name/desktop/app/api/tasks",
    );
  });
});

describe("vite-plugin dependency prebundling", () => {
  it("prebundles only direct DevShell markdown dependencies", () => {
    const qplugin = getLocalAppworkPlugin({ command: "serve" });
    const config = qplugin.config?.({}, { command: "serve" });

    expect(config.optimizeDeps.include).toEqual(
      expect.arrayContaining(["react-markdown", "remark-gfm", "unified", "remark-parse"]),
    );
    expect(config.optimizeDeps.include).not.toContain("style-to-js");
    expect(config.optimizeDeps.include).not.toContain("debug");
  });
});

describe("vite-plugin dev server address", () => {
  it("fails clearly when canonical Server development configuration is incomplete", () => {
    expect(() => buildDevServer({})).toThrow(/dev-config\.json.*serverUrl.*userId.*pageName.*apiKey.*appServerPort/i);
  });

  it("forces the credential-injecting Vite listener to loopback", () => {
    const server = buildDevServer(
      TEST_DEV_CONFIG,
      { host: "0.0.0.0", open: false },
    );

    expect(server).toMatchObject({
      host: "127.0.0.1",
      open: false,
      port: 5182,
      strictPort: true,
      allowedHosts: ["localhost", "127.0.0.1"],
    });
    expect(server.proxy["/api"].target).toBe("http://127.0.0.1:43127");
  });

  it.each([
    "https://127.0.0.1:43127",
    "http://localhost:43127",
    "http://192.0.2.10:43127",
    "http://user:password@127.0.0.1:43127",
    "http://127.0.0.1:43127/base",
    "http://127.0.0.1:43127?target=remote",
    "http://127.0.0.1:43127#fragment",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1",
  ])("rejects a non-canonical credential proxy target: %s", (serverUrl) => {
    expect(() => buildDevServer({ ...TEST_DEV_CONFIG, serverUrl })).toThrow(
      /serverUrl.*http:\/\/127\.0\.0\.1:<nonzero-port>/i,
    );
  });
});
