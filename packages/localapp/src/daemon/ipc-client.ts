import net from "node:net";
import { lifecycleError } from "../errors.js";
import {
  CONTROL_FRAME_LIMIT_BYTES,
  encodeControlRequest,
  parseControlResponseFrame,
  type DaemonControlRequest,
  type DaemonControlResponse,
} from "./control-protocol.js";

export interface IpcClientOptions { endpoint: string; timeoutMs?: number; }
export interface IpcClient { request(request: DaemonControlRequest): Promise<DaemonControlResponse>; }
const DEFAULT_TIMEOUT_MS = 5_000;

export function createIpcClient(options: IpcClientOptions): IpcClient {
  return { request: (request) => requestIpc(options.endpoint, request, options.timeoutMs ?? DEFAULT_TIMEOUT_MS) };
}

function requestIpc(endpoint: string, request: DaemonControlRequest, timeoutMs: number): Promise<DaemonControlResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, response?: DaemonControlResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error === undefined ? resolve(response!) : reject(error);
    };
    const timer = setTimeout(() => finish(lifecycleError("ipc_timeout", "The LocalApp daemon control request timed out")), timeoutMs);
    timer.unref?.();
    socket.once("error", (error: NodeJS.ErrnoException) => finish(transportError(error)));
    socket.once("connect", () => socket.end(encodeControlRequest(request)));
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (bytes.byteLength + chunk.byteLength > CONTROL_FRAME_LIMIT_BYTES) return finish(lifecycleError("ipc_response_invalid", "The LocalApp daemon response is too large"));
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.indexOf(0x0a) < 0) return;
      if (bytes.indexOf(0x0a) !== bytes.byteLength - 1) return finish(lifecycleError("ipc_response_invalid", "The LocalApp daemon response has trailing data"));
    });
    socket.once("end", () => {
      if (settled) return;
      try { finish(undefined, parseControlResponseFrame(bytes)); }
      catch { finish(lifecycleError("ipc_response_invalid", "The LocalApp daemon response is invalid")); }
    });
  });
}

function transportError(error: NodeJS.ErrnoException): Error {
  if (error.code === "ENOENT" || error.code === "ECONNREFUSED") return lifecycleError("ipc_unreachable", "The LocalApp daemon control endpoint is unavailable");
  return lifecycleError("ipc_transport_failed", "The LocalApp daemon control transport failed");
}
