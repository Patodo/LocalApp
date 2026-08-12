import { describe, expect, it, vi } from "vitest";
import { runServerCommand } from "../src/commands/server.js";
import type { RuntimeLayout } from "../src/daemon/runtime-layout.js";

const layout = {
  supportDir: "/support", dataDir: "/support/data", releasesDir: "/support/releases", currentManifestPath: "/support/current.json",
  launcherPath: "/support/bin/localapp-daemon-bootstrap.mjs", logsDir: "/support/logs", daemonLogPath: "/support/logs/daemon.log",
  runtimeDir: "/run", lockPath: "/run/daemon.lock", releaseLockPath: "/run/release.lock", controlEndpoint: "/run/control.sock", platform: "linux",
} satisfies RuntimeLayout;

describe("server lifecycle command", () => {
  it("publishes on each start but installs the per-user service only once", async () => {
    const install = vi.fn(async () => ({ mode: "service" as const, installed: false }));
    const start = vi.fn(async () => undefined);
    const readyStatus = { ok: true as const, type: "status" as const, data: {
      bootId: "boot_0123456789abcdef", pid: 42, server: { status: "ready" as const, listenUrl: "http://127.0.0.1:43127" },
    } };
    const status = vi.fn().mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ipc_unreachable" })).mockResolvedValue(readyStatus);
    const dependencies = {
      layout, publishRelease: vi.fn(async () => ({ version: "1", artifactDigest: "a".repeat(64), releasePath: "/support/releases/1", entrypoint: "bin/localapp.mjs", bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs" })),
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
});
