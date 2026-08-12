import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import {
  CONTROL_FRAME_LIMIT_BYTES,
  encodeControlResponse,
  parseControlRequestFrame,
  type DaemonControlRequest,
  type DaemonControlResponse,
} from "./control-protocol.js";

export interface IpcServerOptions {
  endpoint: string;
  handle(request: DaemonControlRequest): Promise<DaemonControlResponse> | DaemonControlResponse;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** A daemon lock holder supplies this before a stale Unix socket is removed. */
  reclaimStaleEndpoint?: () => Promise<boolean>;
  verifyWindowsCurrentUser?: () => Promise<boolean> | boolean;
}

export interface IpcServer {
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export async function createIpcServer(options: IpcServerOptions): Promise<IpcServer> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (options.verifyWindowsCurrentUser === undefined || !await options.verifyWindowsCurrentUser()) {
      throw lifecycleError("ipc_windows_acl_unavailable", "LocalApp refuses to expose an unverified Windows control pipe");
    }
  } else {
    await prepareUnixEndpoint(options.endpoint, options.reclaimStaleEndpoint);
  }
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    void serveConnection(socket, options.handle, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      .finally(() => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.endpoint, () => { server.off("error", reject); resolve(); });
  });
  let identity: FileIdentity | undefined;
  if (platform !== "win32") {
    const stat = await fs.lstat(options.endpoint, { bigint: true });
    if (!stat.isSocket() || stat.isSymbolicLink()) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint is not a socket");
    }
    identity = { dev: stat.dev, ino: stat.ino };
  }
  let closing: Promise<void> | undefined;
  return {
    close() {
      closing ??= closeServer(server, sockets, options.endpoint, identity);
      return closing;
    },
  };
}

async function serveConnection(
  socket: net.Socket,
  handle: IpcServerOptions["handle"],
  timeoutMs: number,
): Promise<void> {
  socket.setNoDelay(true);
  let bytes = Buffer.alloc(0);
  let dispatched = false;
  let responded = false;
  const finish = (response: DaemonControlResponse) => {
    if (responded) return;
    responded = true;
    clearTimeout(timer);
    let encoded: Buffer;
    try { encoded = encodeControlResponse(response); }
    catch { encoded = Buffer.from('{"ok":false,"code":"IPC_RESPONSE_INVALID","message":"IPC response failed"}\n'); }
    socket.end(encoded);
  };
  const fail = (code: string) => finish({ ok: false, code, message: code });
  const timer = setTimeout(() => fail("IPC_TIMEOUT"), timeoutMs);
  timer.unref?.();
  socket.on("error", () => { clearTimeout(timer); responded = true; });
  socket.on("data", (chunk: Buffer) => {
    if (responded || dispatched) return;
    if (bytes.byteLength + chunk.byteLength > CONTROL_FRAME_LIMIT_BYTES) return fail("IPC_MESSAGE_TOO_LARGE");
    bytes = Buffer.concat([bytes, chunk]);
    const newline = bytes.indexOf(0x0a);
    if (newline < 0) return;
    try {
      const request = parseControlRequestFrame(bytes);
      dispatched = true;
      Promise.resolve(handle(request)).then((response) => {
        finish(response);
      }, () => finish({ ok: false, code: "IPC_HANDLER_FAILED", message: "IPC handler failed" }));
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code : "IPC_REQUEST_INVALID";
      fail(code);
    }
  });
  socket.on("end", () => { if (!responded && !dispatched) fail("IPC_FRAME_INCOMPLETE"); });
}

async function prepareUnixEndpoint(endpoint: string, reclaim: IpcServerOptions["reclaimStaleEndpoint"]): Promise<void> {
  const parent = path.dirname(endpoint);
  const parentStat = await fs.lstat(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (parentStat === undefined || !parentStat.isDirectory() || parentStat.isSymbolicLink()
    || (Number(parentStat.mode) & 0o077) !== 0) {
    throw lifecycleError("ipc_path_unsafe", "The LocalApp control directory is not private");
  }
  const existing = await fs.lstat(endpoint, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing === undefined) return;
  if (!existing.isSocket() || existing.isSymbolicLink() || reclaim === undefined || !await reclaim()) {
    throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint already exists");
  }
  const current = await fs.lstat(endpoint, { bigint: true });
  if (!current.isSocket() || current.isSymbolicLink() || current.dev !== existing.dev || current.ino !== existing.ino) {
    throw lifecycleError("ipc_path_unsafe", "The LocalApp control endpoint changed during stale cleanup");
  }
  await fs.unlink(endpoint);
}

interface FileIdentity { dev: bigint; ino: bigint; }

async function closeServer(server: net.Server, sockets: Set<net.Socket>, endpoint: string, identity: FileIdentity | undefined): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (identity === undefined) return;
  const current = await fs.lstat(endpoint, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (current !== undefined && current.isSocket() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
    await fs.unlink(endpoint);
  }
}
