import { describe, expect, it, vi } from "vitest";
import { runServerCommand } from "../src/commands/server.js";
import type { RuntimeLayout } from "../src/daemon/runtime-layout.js";

const layout = {
  supportDir: "/support", dataDir: "/support/data", releasesDir: "/support/releases", currentManifestPath: "/support/current.json",
  launcherPath: "/support/bin/localapp-daemon-bootstrap.mjs", logsDir: "/support/logs", daemonLogPath: "/support/logs/daemon.log",
  runtimeDir: "/run", lockPath: "/run/daemon.lock", releaseLockPath: "/run/release.lock", controlEndpoint: "/run/control.sock", platform: "linux",
} satisfies RuntimeLayout;

describe("server lifecycle command", () => {
  it("installs the selected native Scheme handler after artifact verification", async () => {
    const installScheme = vi.fn(async () => undefined);
    const createNativeAdapter = vi.fn(async () => ({ installScheme }));
    await runServerCommand({ action: "start" }, {
      layout,
      artifactDirectory: "/artifact",
      verifyReleaseArtifact: vi.fn(async () => ({ serverEntrypoint: "runtime/server/bin/localapp-server.mjs" })),
      publishRelease: vi.fn(async () => ({ version: "1", artifactDigest: "a".repeat(64), releasePath: "/release", entrypoint: "bin/localapp.mjs", bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs" })),
      createNativeAdapter,
      createServiceManager: () => ({ install: vi.fn(async () => ({ mode: "foreground" as const, installed: false })), start: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), uninstall: vi.fn(), logs: vi.fn(), registrationPath: "/service" }),
    });
    expect(createNativeAdapter).toHaveBeenCalledWith("/release/runtime/native", { supportDir: "/support" });
    expect(installScheme).toHaveBeenCalledTimes(1);
  });

  it("publishes on each start and idempotently checks the per-user service", async () => {
    const install = vi.fn(async () => ({ mode: "service" as const, installed: false }));
    const start = vi.fn(async () => undefined);
    const readyStatus = { ok: true as const, type: "status" as const, data: {
      bootId: "boot_0123456789abcdef", pid: 42, server: { status: "ready" as const, listenUrl: "http://127.0.0.1:43127" },
    } };
    const status = vi.fn().mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ipc_unreachable" })).mockResolvedValue(readyStatus);
    const dependencies = {
      layout, publishRelease: vi.fn(async () => ({ version: "1", artifactDigest: "a".repeat(64), releasePath: "/support/releases/1", entrypoint: "bin/localapp.mjs", bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs" })),
      createNativeAdapter: async () => ({ installScheme: async () => undefined }),
      createServiceManager: () => ({ install, start, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), uninstall: vi.fn(), logs: vi.fn(), registrationPath: "/support/service" }),
      ipcClient: () => ({ request: status }), health: vi.fn(async () => undefined), artifactDirectory: "/artifact", verifyReleaseArtifact: vi.fn(),
    };
    await runServerCommand({ action: "start" }, dependencies);
    await runServerCommand({ action: "start" }, dependencies);
    expect(dependencies.publishRelease).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(3);
  });

  it("does not use service-manager state as server status proof", async () => {
    await expect(runServerCommand({ action: "status" }, {
      layout, artifactDirectory: "/artifact",
      createServiceManager: () => ({ install: vi.fn(), start: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(async () => true), uninstall: vi.fn(), logs: vi.fn(), registrationPath: "/support/service" }),
      ipcClient: () => ({ request: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ipc_unreachable" }); }) }),
      health: vi.fn(), publishRelease: vi.fn(),
    })).rejects.toMatchObject({ code: "daemon_unreachable" });
  });

  it("reports Linux foreground fallback without trying to start a missing user manager", async () => {
    const start = vi.fn(async () => undefined);
    const result = await runServerCommand({ action: "start" }, {
      layout, artifactDirectory: "/artifact", verifyReleaseArtifact: vi.fn(async () => ({ serverEntrypoint: "runtime/server/bin/localapp-server.mjs" })),
      publishRelease: vi.fn(async () => ({ version: "1", artifactDigest: "a".repeat(64), releasePath: "/release", entrypoint: "bin/localapp.mjs", bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs" })),
      createNativeAdapter: async () => ({ installScheme: async () => undefined }),
      createServiceManager: () => ({ install: vi.fn(async () => ({ mode: "foreground" as const, installed: false, reason: "systemd user manager unavailable" })), start, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), uninstall: vi.fn(), logs: vi.fn(), registrationPath: "/service" }),
    });
    expect(result).toEqual({ action: "start", mode: "foreground", reason: "systemd user manager unavailable" });
    expect(start).not.toHaveBeenCalled();
  });

  it("waits for proven terminal ownership after service fallback stop", async () => {
    const stop = vi.fn(async () => undefined);
    const request = vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ipc_unreachable" }); });
    await expect(runServerCommand({ action: "stop" }, {
      layout, ipcClient: () => ({ request }),
      createServiceManager: () => ({ install: vi.fn(), start: vi.fn(), stop, restart: vi.fn(), status: vi.fn(), uninstall: vi.fn(), logs: vi.fn(), registrationPath: "/service" }),
    })).resolves.toMatchObject({ action: "stop", stopped: { via: "service" } });
    expect(stop).toHaveBeenCalledTimes(1);
    // One request selects fallback; the second proves endpoint absence after it.
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("waits for proven terminal ownership before fallback uninstall unregisters", async () => {
    const uninstall = vi.fn(async () => undefined);
    const request = vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ipc_unreachable" }); });
    await expect(runServerCommand({ action: "uninstall" }, {
      layout, ipcClient: () => ({ request }),
      createServiceManager: () => ({ install: vi.fn(), start: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), uninstall, logs: vi.fn(), registrationPath: "/service" }),
    })).resolves.toMatchObject({ action: "uninstall", stopped: { via: "service" } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(uninstall).toHaveBeenCalledTimes(1);
  });
});
