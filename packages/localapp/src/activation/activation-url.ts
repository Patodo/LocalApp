import { parseDeviceActivationUrl, type DeviceActivationTicket } from "@localapp/server/device-action-ticket";
import { lifecycleError } from "../errors.js";

export const ACTIVATION_URL_LIMIT_BYTES = 4096;

export type DeviceActionActivation = {
  kind: "device-action";
  ticket: DeviceActivationTicket;
};

export type NotificationActivation = {
  kind: "notification";
  ticket: string;
};

export type Activation = DeviceActionActivation | NotificationActivation;

const NOTIFICATION_TICKET = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Parses the complete OS-delivered Scheme URL into the only data daemon policy
 * may receive. No URL instance or incidental query field escapes this boundary.
 */
export function parseActivationUrl(value: unknown): Activation {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > ACTIVATION_URL_LIMIT_BYTES) return invalid();
  if (value.startsWith("localapp://action/")) {
    try { return { kind: "device-action", ticket: parseDeviceActivationUrl(value) }; }
    catch { return invalid(); }
  }
  if (!value.startsWith("localapp://notification/open?")) return invalid();
  let parsed: URL;
  try { parsed = new URL(value); } catch { return invalid(); }
  if (parsed.protocol !== "localapp:" || parsed.hostname !== "notification" || parsed.port !== ""
    || parsed.username || parsed.password || parsed.hash || parsed.pathname !== "/open") return invalid();
  const entries = [...parsed.searchParams.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "ticket" || !NOTIFICATION_TICKET.test(entries[0]?.[1] ?? "")) return invalid();
  const ticket = entries[0]![1];
  if (value !== `localapp://notification/open?ticket=${ticket}`) return invalid();
  return { kind: "notification", ticket };
}

function invalid(): never {
  throw lifecycleError("activation_url_invalid", "ACTIVATION_URL_INVALID");
}
