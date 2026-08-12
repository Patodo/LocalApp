import { TextDecoder } from "node:util";
import { lifecycleError } from "../errors.js";

export const CONTROL_FRAME_LIMIT_BYTES = 64 * 1024;

export type DaemonControlRequest =
  | { type: "status" }
  | { type: "stop" }
  | { type: "restart" }
  /** Complete, unparsed OS Scheme input. The daemon reparses it before policy. */
  | { type: "activation"; url: string };

export type DaemonServerStatus = "starting" | "ready" | "stopping" | "stopped" | "error";

export type DaemonControlResponse =
  | {
    ok: true;
    type: "status";
    data: {
      bootId: string;
      pid: number;
      server: { status: DaemonServerStatus; listenUrl?: string; setupUrl?: string };
    };
  }
  | { ok: true; type: "stop" | "restart" | "activation" }
  | { ok: false; code: string; message: string };

const decoder = new TextDecoder("utf-8", { fatal: true });
const REQUEST_TYPES = new Set(["status", "stop", "restart", "activation"]);
const RESPONSE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const BOOT_ID = /^[A-Za-z0-9_-]{16,128}$/;

export function encodeControlRequest(request: DaemonControlRequest): Buffer {
  return encodeFrame(validateControlRequest(request));
}

export function parseControlRequestFrame(frame: Uint8Array): DaemonControlRequest {
  const value = parseFrame(frame);
  return validateControlRequest(value);
}

export function encodeControlResponse(response: DaemonControlResponse): Buffer {
  return encodeFrame(validateControlResponse(response));
}

export function parseControlResponseFrame(frame: Uint8Array): DaemonControlResponse {
  const value = parseFrame(frame);
  return validateControlResponse(value);
}

function parseFrame(frame: Uint8Array): unknown {
  if (frame.byteLength > CONTROL_FRAME_LIMIT_BYTES) throw protocolError("IPC_MESSAGE_TOO_LARGE");
  let text: string;
  try {
    text = decoder.decode(frame);
  } catch {
    throw protocolError("IPC_INVALID_UTF8");
  }
  const newline = text.indexOf("\n");
  if (newline < 0) throw protocolError("IPC_FRAME_INCOMPLETE");
  const trailing = text.slice(newline + 1);
  if (trailing.length > 0) {
    throw protocolError(trailing.includes("\n") ? "IPC_MULTIPLE_FRAMES" : "IPC_TRAILING_DATA");
  }
  const json = text.slice(0, newline);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw protocolError("IPC_JSON_INVALID");
  }
  assertNoDuplicateJsonKeys(json);
  return parsed;
}

function encodeFrame(value: unknown): Buffer {
  const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (frame.byteLength > CONTROL_FRAME_LIMIT_BYTES) throw protocolError("IPC_MESSAGE_TOO_LARGE");
  return frame;
}

function validateControlRequest(value: unknown): DaemonControlRequest {
  if (!isRecord(value) || typeof value.type !== "string") throw protocolError("IPC_REQUEST_INVALID");
  if (!REQUEST_TYPES.has(value.type)) throw protocolError("IPC_REQUEST_UNSUPPORTED");
  if (value.type === "activation") {
    if (!hasExactKeys(value, ["type", "url"]) || typeof value.url !== "string" || Buffer.byteLength(value.url, "utf8") > 4096) {
      throw protocolError("IPC_REQUEST_INVALID");
    }
    return { type: "activation", url: value.url };
  }
  if (!hasExactKeys(value, ["type"])) throw protocolError("IPC_REQUEST_INVALID");
  return { type: value.type as "status" | "stop" | "restart" };
}

function validateControlResponse(value: unknown): DaemonControlResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw protocolError("IPC_RESPONSE_INVALID");
  if (!value.ok) {
    if (!hasExactKeys(value, ["ok", "code", "message"])
      || typeof value.code !== "string" || !RESPONSE_ERROR_CODE.test(value.code)
      || typeof value.message !== "string" || value.message.length < 1 || value.message.length > 512
      || /[\r\n]/.test(value.message)) throw protocolError("IPC_RESPONSE_INVALID");
    return { ok: false, code: value.code, message: value.message };
  }
  if (value.type === "stop" || value.type === "restart" || value.type === "activation") {
    if (!hasExactKeys(value, ["ok", "type"])) throw protocolError("IPC_RESPONSE_INVALID");
    return { ok: true, type: value.type };
  }
  if (value.type !== "status" || !hasExactKeys(value, ["ok", "type", "data"]) || !isRecord(value.data)) {
    throw protocolError("IPC_RESPONSE_INVALID");
  }
  const data = value.data;
  if (!hasExactKeys(data, ["bootId", "pid", "server"])
    || typeof data.bootId !== "string" || !BOOT_ID.test(data.bootId)
    || typeof data.pid !== "number" || !Number.isSafeInteger(data.pid) || data.pid <= 0
    || !isRecord(data.server)) throw protocolError("IPC_RESPONSE_INVALID");
  const server = validateServerStatus(data.server);
  return { ok: true, type: "status", data: { bootId: data.bootId, pid: data.pid, server } };
}

function validateServerStatus(value: Record<string, unknown>): { status: DaemonServerStatus; listenUrl?: string; setupUrl?: string } {
  const statuses = new Set<DaemonServerStatus>(["starting", "ready", "stopping", "stopped", "error"]);
  if (typeof value.status !== "string" || !statuses.has(value.status as DaemonServerStatus)) {
    throw protocolError("IPC_RESPONSE_INVALID");
  }
  const expectedKeys = value.listenUrl === undefined ? ["status"]
    : value.setupUrl === undefined ? ["status", "listenUrl"] : ["status", "listenUrl", "setupUrl"];
  if (!hasExactKeys(value, expectedKeys)) throw protocolError("IPC_RESPONSE_INVALID");
  if (value.listenUrl !== undefined) {
    if (value.status !== "ready" || typeof value.listenUrl !== "string" || !isLoopbackHttpOrigin(value.listenUrl)) {
      throw protocolError("IPC_RESPONSE_INVALID");
    }
    if (value.setupUrl !== undefined && (typeof value.setupUrl !== "string" || !isSetupUrl(value.setupUrl, value.listenUrl))) {
      throw protocolError("IPC_RESPONSE_INVALID");
    }
    return {
      status: value.status as DaemonServerStatus,
      listenUrl: value.listenUrl,
      ...(typeof value.setupUrl === "string" ? { setupUrl: value.setupUrl } : {}),
    };
  }
  if (value.status === "ready") throw protocolError("IPC_RESPONSE_INVALID");
  return { status: value.status as DaemonServerStatus };
}

function isSetupUrl(value: string, listenUrl: string): boolean {
  try {
    const url = new URL(value);
    const token = url.searchParams.get("token");
    return url.origin === listenUrl && url.pathname === "/setup" && url.hash === ""
      && [...url.searchParams.keys()].length === 1 && typeof token === "string"
      && token.length >= 16 && token.length <= 512;
  } catch {
    return false;
  }
}

function isLoopbackHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")
      && url.username === "" && url.password === "" && url.pathname === "/"
      && url.search === "" && url.hash === "" && url.port !== "";
  } catch {
    return false;
  }
}

function protocolError(code: string): Error {
  return lifecycleError(code, code);
}

function assertNoDuplicateJsonKeys(json: string): void {
  let index = 0;
  const whitespace = () => {
    while (index < json.length && /[\t\n\r ]/.test(json[index]!)) index += 1;
  };
  const stringValue = (): string => {
    const start = index;
    index += 1;
    while (index < json.length) {
      if (json[index] === "\\") {
        index += 2;
        continue;
      }
      if (json[index] === '"') {
        index += 1;
        return JSON.parse(json.slice(start, index)) as string;
      }
      index += 1;
    }
    throw protocolError("IPC_JSON_INVALID");
  };
  const value = (): void => {
    whitespace();
    const first = json[index];
    if (first === "{") {
      index += 1;
      whitespace();
      const keys = new Set<string>();
      if (json[index] === "}") {
        index += 1;
        return;
      }
      while (index < json.length) {
        whitespace();
        if (json[index] !== '"') throw protocolError("IPC_JSON_INVALID");
        const key = stringValue();
        if (keys.has(key)) throw protocolError("IPC_JSON_DUPLICATE_KEY");
        keys.add(key);
        whitespace();
        if (json[index] !== ":") throw protocolError("IPC_JSON_INVALID");
        index += 1;
        value();
        whitespace();
        if (json[index] === "}") {
          index += 1;
          return;
        }
        if (json[index] !== ",") throw protocolError("IPC_JSON_INVALID");
        index += 1;
      }
      throw protocolError("IPC_JSON_INVALID");
    }
    if (first === "[") {
      index += 1;
      whitespace();
      if (json[index] === "]") {
        index += 1;
        return;
      }
      while (index < json.length) {
        value();
        whitespace();
        if (json[index] === "]") {
          index += 1;
          return;
        }
        if (json[index] !== ",") throw protocolError("IPC_JSON_INVALID");
        index += 1;
      }
      throw protocolError("IPC_JSON_INVALID");
    }
    if (first === '"') {
      stringValue();
      return;
    }
    while (index < json.length && !/[\t\n\r ,\]}]/.test(json[index]!)) index += 1;
  };
  value();
  whitespace();
  if (index !== json.length) throw protocolError("IPC_JSON_INVALID");
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
