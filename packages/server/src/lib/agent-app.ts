import { findUserByName, findUserById } from "./meta-sqlite.js";
import { getPageDir, readPageMeta } from "../plugins/storage.js";
import { readManifestState } from "./app-manifest.js";
import { checkPageAccess } from "./access-control.js";
import { AGENT_CAPABILITIES, type AgentCapability } from "./agent-settings.js";

export function resolveAgentApp(dataDir: string, userId: string, appId?: string) {
  if (!appId || appId === "platform") return { id: "platform", capabilities: [] as AgentCapability[] };
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(appId)) throw new Error("Invalid application identity");
  const [ownerName, name] = appId.split("/");
  const owner = findUserByName(ownerName) ?? findUserById(ownerName);
  const meta = owner && readPageMeta(dataDir, owner.id, name);
  if (!owner || !meta || !checkPageAccess(meta.pageAccess, userId, meta.userId) || meta.lifecycle?.status === "offline") throw new Error("Application is unavailable");
  const manifest = readManifestState(getPageDir(dataDir, owner.id, name), meta).effectiveManifest;
  const agent = manifest.agent as { capabilities?: unknown } | undefined;
  const capabilities = agent?.capabilities;
  if (capabilities !== undefined && (!Array.isArray(capabilities) || capabilities.some((c) => !AGENT_CAPABILITIES.includes(c)))) throw new Error("Invalid application Agent capabilities");
  return { id: `${owner.name}/${name}`, capabilities: (capabilities ?? []) as AgentCapability[] };
}
