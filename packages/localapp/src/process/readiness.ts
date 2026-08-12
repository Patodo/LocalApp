import { createInterface } from "node:readline";
import type { OwnedProcess } from "./process-tree.js";

export interface ServerReadyEvent {
  type: "ready";
  listenUrl: string;
  url?: string;
  setupUrl?: string;
  workerPid?: number;
}

export interface WaitForServerReadyOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_READY_TIMEOUT_MS = 15_000;

export function waitForServerReady(
  process: OwnedProcess,
  options: WaitForServerReadyOptions = {},
): Promise<ServerReadyEvent> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const stdout = process.child.stdout;
  if (stdout === null) return Promise.reject(new Error("Local Server stdout is unavailable for structured readiness"));
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: stdout, crlfDelay: Infinity });
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Local Server readiness timed out after ${timeoutMs} ms`)), timeoutMs);
    timer.unref?.();
    const finish = (error?: Error, event?: ServerReadyEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      process.child.off("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else {
        stdout.resume();
        resolve(event!);
      }
    };
    const onError = () => finish(new Error("Local Server failed before readiness"));
    const onAbort = () => finish(new Error("Local Server readiness aborted"));
    process.child.once("error", onError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    process.exited.then((exit) => {
      if (!settled) finish(new Error(`Local Server exited before readiness${exit.code === null ? "" : ` with code ${exit.code}`}`));
    });
    lines.on("line", (line) => {
      let value: unknown;
      try { value = JSON.parse(line); } catch { return; }
      if (!isRecord(value) || value.type !== "ready") return;
      if (typeof value.listenUrl !== "string") {
        finish(new Error("Local Server readiness did not include listenUrl"));
        return;
      }
      let listenUrl: string;
      try { listenUrl = canonicalLoopbackUrl(value.listenUrl); }
      catch (error) { finish(error as Error); return; }
      finish(undefined, {
        type: "ready",
        listenUrl,
        ...(typeof value.url === "string" ? { url: value.url } : {}),
        ...(typeof value.setupUrl === "string" ? { setupUrl: value.setupUrl } : {}),
        ...(Number.isSafeInteger(value.workerPid) ? { workerPid: value.workerPid as number } : {}),
      });
    });
    lines.once("error", () => finish(new Error("Failed to read Local Server readiness")));
  });
}

export function canonicalLoopbackUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Local Server readiness listenUrl is not a valid URL"); }
  const port = url.port;
  const canonical = port === "" ? "" : `http://127.0.0.1:${port}`;
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || port === ""
    || Number(port) < 1
    || Number(port) > 65_535
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || (value !== canonical && value !== `${canonical}/`)
  ) {
    throw new Error("Local Server readiness must report an exact http://127.0.0.1:<port> loopback listener");
  }
  return canonical;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
