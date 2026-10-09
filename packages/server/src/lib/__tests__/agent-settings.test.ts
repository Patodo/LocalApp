import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentSettingsStore } from "../agent-settings.js";
import { closeMetaDb, getDb, initMetaDb } from "../meta-sqlite.js";
it("encrypts user credentials and preserves hidden MCP credentials during unrelated edits", async () => {
  const root = path.resolve(__dirname, "../../../../../tmp/agent-settings-test", String(process.pid));
  await fs.mkdir(root, { recursive: true });
  await initMetaDb(root);
  try {
    const store = new AgentSettingsStore(root);
    store.write("alice", { providers: [{ id: "own", name: "Own", protocol: "openai-completions", baseUrl: "http://localhost:1/v1", model: "model", apiKey: "test-provider-secret-marker" }], defaultProviderId: "own", grants: { "owner/app": ["files"] }, mcpServers: [{ serverName: "remote", url: "https://mcp.test/service?token=url-secret-marker", headers: { Authorization: "test-header-secret-marker" } }, { serverName: "command", transport: "stdio", command: "node", args: ["arg-secret-marker"], env: { TOKEN: "test-env-secret-marker" } }] });
    const publicValue = store.publicSettings("alice");
    expect(JSON.stringify(publicValue)).not.toContain("secret-marker");
    expect(publicValue.providers[0].hasApiKey).toBe(true);
    const encoded = JSON.stringify(getDb().exec("SELECT value FROM agent_user_settings"));
    expect(encoded).not.toContain("secret-marker");
    expect(store.read("bob").providers).toHaveLength(0);
    store.write("alice", { ...publicValue, providers: publicValue.providers.map((provider) => ({ ...provider, name: "Renamed" })) });
    const updated = store.read("alice");
    expect(updated.providers[0].apiKey).toBe("test-provider-secret-marker");
    expect(updated.mcpServers[0].url).toContain("url-secret-marker");
    expect(updated.mcpServers[0].headers?.Authorization).toBe("test-header-secret-marker");
    expect(updated.mcpServers[1].args).toEqual(["arg-secret-marker"]);
    expect(updated.mcpServers[1].env?.TOKEN).toBe("test-env-secret-marker");
    closeMetaDb(); await initMetaDb(root);
    expect(new AgentSettingsStore(root).read("alice").providers[0].apiKey).toBe("test-provider-secret-marker");
  } finally { closeMetaDb(); await fs.rm(root, { recursive: true, force: true }); }
});
