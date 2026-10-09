import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {ProfileStore} from "../config/profile-store.js";
import {LocalAppClient} from "../http/localapp-client.js";
import {collectSource, type SourceFile} from "../project/source.js";

interface SourceState {serverUrl: string; ownerId: string; name: string; projectId: string; digest: string}
interface Bundle {project: {id: string; ownerId: string; name: string}; files: Record<string, SourceFile>; digest: string}
const statePath = ".localapp/source.json";
async function data<T>(response: Awaited<ReturnType<LocalAppClient["getJson"]>>): Promise<T> {
  if (!response.ok) throw new Error(response.error);
  const body = response.body as {success: boolean; data: T};
  if (!body?.success) throw new Error("Server returned an unsuccessful response");
  return body.data;
}
async function saveState(root: string, state: SourceState) {
  const directory = path.join(root, ".localapp");
  await fs.mkdir(directory, {recursive: true});
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe .localapp directory");
  const temporary = path.join(directory, `source-${randomUUID()}.json`);
  try { await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", {flag: "wx", mode: 0o600}); await fs.rename(temporary, path.join(root, statePath)); }
  finally { await fs.rm(temporary, {force: true}); }
}
export async function syncSource(options: {action: "pull" | "push"; profile: string; directory: string; name?: string; store?: Pick<ProfileStore, "resolve">}) {
  const profile = await (options.store ?? new ProfileStore()).resolve(options.profile);
  const client = new LocalAppClient(profile), root = path.resolve(options.directory);
  const me = await data<{id: string}>(await client.getJson("/api/me"));
  if (options.action === "pull") {
    if (!options.name || !/^[a-zA-Z0-9_-]+$/.test(options.name)) throw new Error("Specify a valid application name");
    const project = await data<{id: string} | null>(await client.getJson(`/api/development/apps/${encodeURIComponent(options.name)}/source`));
    if (!project) throw new Error("Application source is not hosted; migrate original source first");
    const bundle = await data<Bundle>(await client.getJson(`/api/development/projects/${encodeURIComponent(project.id)}/source`));
    // A fresh destination makes conflict recovery explicit and never overwrites local work.
    await fs.mkdir(path.dirname(root), {recursive: true});
    const stage = root + "-pull-" + randomUUID();
    await fs.mkdir(stage);
    try {
      for (const [relative, content] of Object.entries(bundle.files)) {
        if (relative.includes("\\") || relative.split("/").some(p => !p || p === "." || p === "..") || path.isAbsolute(relative)) throw new Error("Unsafe source path from Server");
        const destination = path.join(stage, relative);
        await fs.mkdir(path.dirname(destination), {recursive: true});
        await fs.writeFile(destination, typeof content === "string" ? content : Buffer.from(content.content, "base64"), {flag: "wx", mode: 0o600});
      }
      await collectSource(stage);
      await saveState(stage, {serverUrl: profile.serverUrl, ownerId: me.id, name: bundle.project.name, projectId: project.id, digest: bundle.digest});
      // mkdir is exclusive; an existing destination is always refused, even when empty.
      await fs.mkdir(root);
      try { for (const entry of await fs.readdir(stage)) await fs.rename(path.join(stage, entry), path.join(root, entry)); }
      catch (error) { await fs.rm(root, {recursive: true, force: true}); throw error; }
      return {status: "pulled", directory: root, application: bundle.project.name, serverUrl: profile.serverUrl};
    } finally { await fs.rm(stage, {recursive: true, force: true}); }
  }
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.lstat(path.join(root, ".localapp"))).isSymbolicLink() || (await fs.lstat(path.join(root, statePath))).isSymbolicLink()) throw new Error("Unsafe source state path");
  const state: SourceState = JSON.parse(await fs.readFile(path.join(root, statePath), "utf8"));
  if (state.serverUrl !== profile.serverUrl || state.ownerId !== me.id) throw new Error("Target Server or API Key user differs from source checkout");
  const source = await collectSource(root);
  if (source.name !== state.name) throw new Error("Application name differs from checkout");
  const result = await data<{digest: string; version: {id: string}}>(await client.postJson(`/api/development/projects/${encodeURIComponent(state.projectId)}/source`, {files: source.files, expectedDigest: state.digest}, 60000));
  await saveState(root, {...state, digest: result.digest});
  return {status: "pushed", application: state.name, sourceVersion: result.version.id, deployed: false};
}
