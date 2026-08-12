import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import { CONTROL_FRAME_LIMIT_BYTES, encodeControlResponse, parseControlRequestFrame, type DaemonControlRequest, type DaemonControlResponse } from "./control-protocol.js";

export interface IpcServerOptions {
  endpoint: string;
  handle(request: DaemonControlRequest): Promise<DaemonControlResponse> | DaemonControlResponse;
  afterResponse?: (request: DaemonControlRequest, response: DaemonControlResponse) => Promise<void> | void;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  reclaimStaleEndpoint?: () => Promise<boolean>;
  verifyWindowsCurrentUser?: () => Promise<boolean> | boolean;
}
export interface IpcServer { close(): Promise<void>; }
const DEFAULT_TIMEOUT_MS = 5_000;

export async function createIpcServer(options: IpcServerOptions): Promise<IpcServer> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (options.verifyWindowsCurrentUser === undefined || !await options.verifyWindowsCurrentUser()) throw lifecycleError("ipc_windows_acl_unavailable", "LocalApp refuses to expose an unverified Windows control pipe");
  } else await prepareUnixEndpoint(options.endpoint, options.reclaimStaleEndpoint);
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    void serveConnection(socket, options.handle, options.afterResponse, options.timeoutMs ?? DEFAULT_TIMEOUT_MS).finally(() => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.endpoint, () => { server.off("error", reject); resolve(); }); });
  let identity: FileIdentity | undefined;
  if (platform !== "win32") {
    const stat = await fs.lstat(options.endpoint, { bigint: true });
    if (!stat.isSocket() || stat.isSymbolicLink()) { await closeNetServer(server); throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint is not a socket"); }
    identity = { dev: stat.dev, ino: stat.ino };
  }
  let closing: Promise<void> | undefined;
  return { close: () => (closing ??= closeServer(server, sockets, options.endpoint, identity, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)) };
}

function serveConnection(socket: net.Socket, handle: IpcServerOptions["handle"], afterResponse: IpcServerOptions["afterResponse"], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    socket.setNoDelay(true);
    let bytes = Buffer.alloc(0);
    let settled = false;
    let requestEnded = false;
    let request: DaemonControlRequest | undefined;
    let response: DaemonControlResponse | undefined;
    const finish = (value: DaemonControlResponse) => {
      if (settled) return;
      settled = true;
      response = value;
      clearTimeout(timer);
      let encoded: Buffer;
      try { encoded = encodeControlResponse(value); } catch { encoded = Buffer.from('{"ok":false,"code":"IPC_RESPONSE_INVALID","message":"IPC response failed"}\n'); }
      socket.end(encoded);
    };
    const close = () => {
      clearTimeout(timer);
      if (!settled) settled = true;
      if (request !== undefined && response !== undefined) void Promise.resolve(afterResponse?.(request, response)).catch(() => undefined);
      resolve();
    };
    const fail = (code: string) => finish({ ok: false, code, message: code });
    const timer = setTimeout(() => { fail("IPC_TIMEOUT"); socket.destroy(); }, timeoutMs);
    timer.unref?.();
    socket.once("error", close);
    socket.once("close", close);
    socket.on("data", (chunk: Buffer) => {
      if (settled || requestEnded || bytes.byteLength + chunk.byteLength > CONTROL_FRAME_LIMIT_BYTES) {
        if (!settled) fail("IPC_MESSAGE_TOO_LARGE");
        return;
      }
      bytes = Buffer.concat([bytes, chunk]);
    });
    socket.once("end", () => {
      requestEnded = true;
      if (settled) return;
      try {
        request = parseControlRequestFrame(bytes);
        Promise.resolve(handle(request)).then(finish, () => fail("IPC_HANDLER_FAILED"));
      } catch (error) {
        fail(typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "IPC_REQUEST_INVALID");
      }
    });
  });
}

async function prepareUnixEndpoint(endpoint: string, reclaim: IpcServerOptions["reclaimStaleEndpoint"]): Promise<void> {
  const parent = path.dirname(endpoint);
  const parentStat = await fs.lstat(parent).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (parentStat === undefined || !parentStat.isDirectory() || parentStat.isSymbolicLink() || (Number(parentStat.mode) & 0o077) !== 0) throw lifecycleError("ipc_path_unsafe", "The LocalApp control directory is not private");
  const existing = await fs.lstat(endpoint, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (existing === undefined) return;
  if (!existing.isSocket() || existing.isSymbolicLink() || reclaim === undefined || !await reclaim()) throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint already exists");
  const current = await fs.lstat(endpoint, { bigint: true });
  if (!current.isSocket() || current.isSymbolicLink() || current.dev !== existing.dev || current.ino !== existing.ino) throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint changed during stale cleanup");
  await fs.unlink(endpoint);
}
interface FileIdentity { dev: bigint; ino: bigint; }
async function closeNetServer(server: net.Server): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }
async function closeServer(server: net.Server, sockets: Set<net.Socket>, endpoint: string, identity: FileIdentity | undefined, timeoutMs: number): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await Promise.race([closeNetServer(server), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  if (identity === undefined) return;
  const current = await fs.lstat(endpoint, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (current !== undefined && current.isSocket() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await fs.unlink(endpoint);
}
