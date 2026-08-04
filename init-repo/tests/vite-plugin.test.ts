// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
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

function getLocalAppworkPlugin(options: { command?: "serve" | "build" } = {}): VitePlugin {
  // @ts-ignore - localapp accepts vite UserConfig-style options
  const plugins = localapp(options);
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

  it("buildAuthConfigure returns undefined when apiKey is empty", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../runtime/vite-plugin.mjs"), "utf-8");
    expect(src).toMatch(/if\s*\(\s*!apiKey\s*\)\s*return\s+undefined/);
  });
});

describe("vite-plugin mini-server routing", () => {
  it("routes Desktop Action endpoints to the platform and ordinary APIs to the mini-server", () => {
    const config = buildProxy(
      {
        serverUrl: "https://prod.example",
        apiKey: "test-key",
        miniServerPort: 5174,
        userId: "testuser",
        pageName: "demo",
      },
      "https://prod.example",
    );

    const desktopActions = config.proxy["/api/desktop-actions"];
    expect(desktopActions.target).toBe("https://prod.example");
    expect(config.proxy["/api"].target).toBe("http://127.0.0.1:5174");
  });

  it("rewrites only exact POST creation and adds canonical auth headers", () => {
    const config = buildProxy(
      {
        apiKey: "test-key",
        miniServerPort: 5174,
        userId: "testuser",
        pageName: "demo",
      },
      "https://prod.example",
    );
    const desktopActions = config.proxy["/api/desktop-actions"];

    const create = applyProxyRequest(
      desktopActions,
      "POST",
      "/api/desktop-actions?source=dev",
    );
    expect(create.path).toBe(
      "/serve/testuser/demo/api/desktop-actions?source=dev",
    );
    expect(create.headers.get("X-API-Key")).toBe("test-key");
    expect(create.headers.get("Referer")).toBe("https://prod.example/testuser/demo/");

    for (const [method, path] of [
      ["GET", "/api/desktop-actions"],
      ["POST", "/api/desktop-actions/"],
      ["GET", "/api/desktop-actions/capabilities"],
      ["GET", "/api/desktop-actions/request-1"],
      ["GET", "/api/desktop-actions/request-1/events"],
      ["PATCH", "/api/desktop-actions/request-1/status"],
      ["POST", "/api/desktop-actions/recover"],
    ]) {
      const forwarded = applyProxyRequest(desktopActions, method, path);
      expect(forwarded.path).toBe(path);
      expect(forwarded.headers.get("X-API-Key")).toBe("test-key");
      expect(forwarded.headers.has("Referer")).toBe(false);
    }
  });

  it("routes /api/llm to production server and other /api to mini-server when miniServerPort exists", () => {
    const config = buildProxy(
      { serverUrl: "https://prod.example", apiKey: "test-key", miniServerPort: 5174 },
      "https://prod.example",
    );

    expect(config.proxy["/api/llm"].target).toBe("https://prod.example");
    expect(config.proxy["/api"].target).toBe("http://127.0.0.1:5174");
    expect(config.proxy["/api"].rewrite).toBeUndefined();
  });

  it("routes local app APIs to mini-server even when serverUrl is empty", () => {
    const config = buildProxy(
      { serverUrl: "", apiKey: "", miniServerPort: 5174 },
      "",
    );

    expect(config.proxy["/api/llm"]).toBeUndefined();
    expect(config.proxy["/api"].target).toBe("http://127.0.0.1:5174");
    expect(config.proxy["/api"].rewrite).toBeUndefined();
  });

  it("keeps platform exceptions before /api fallback", () => {
    const config = buildProxy(
      { serverUrl: "https://prod.example", apiKey: "test-key", miniServerPort: 5174 },
      "https://prod.example",
    );

    expect(Object.keys(config.proxy).slice(0, 3)).toEqual([
      "/api/llm",
      "/api/desktop-actions",
      "/api",
    ]);
  });

  it("falls back to legacy serverUrl proxy when miniServerPort is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = buildProxy(
      { serverUrl: "https://prod.example", apiKey: "test-key", userId: "testuser", pageName: "demo" },
      "https://prod.example",
    );

    expect(config.proxy["/api/me"].target).toBe("https://prod.example");
    expect(config.proxy["/api/desktop-actions"].target).toBe("https://prod.example");
    expect(config.proxy["/api"].target).toBe("https://prod.example");
    expect(config.proxy["/api"].rewrite("/api/tasks")).toBe("/serve/testuser/demo/api/tasks");
    expect(Object.keys(config.proxy).indexOf("/api/desktop-actions")).toBeLessThan(
      Object.keys(config.proxy).indexOf("/api"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("miniServerPort"));
    warn.mockRestore();
  });

  it("uses the same exact creation exception in legacy mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = buildProxy(
      {
        apiKey: "legacy-key",
        userId: "owner name",
        pageName: "desktop/app",
      },
      "https://prod.example/base",
    );
    const desktopActions = config.proxy["/api/desktop-actions"];

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
    warn.mockRestore();
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
  it("uses the CLI-selected app port without discarding user server options", () => {
    const server = buildDevServer(
      { serverUrl: "https://prod.example", miniServerPort: 15174, appServerPort: 5182 },
      { host: "0.0.0.0", open: false },
    );

    expect(server).toMatchObject({
      host: "0.0.0.0",
      open: false,
      port: 5182,
      strictPort: true,
    });
    expect(server.proxy["/api"].target).toBe("http://127.0.0.1:15174");
  });
});
