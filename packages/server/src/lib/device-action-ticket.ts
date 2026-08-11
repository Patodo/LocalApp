import {
  DEVICE_ACTION_PROTOCOL_VERSION,
  DeviceActionPolicyError,
  isDeviceActionId,
  isDeviceActionNonce,
  normalizeDeviceActionOrigin,
  type DeviceActivationTicket,
} from "./device-action-types.js";

const TICKET_KEYS = ["protocolVersion", "sourceOrigin", "actionId", "nonce"] as const;

function invalid(): never {
  throw new DeviceActionPolicyError("DEVICE_ACTION_INVALID_TICKET");
}

export function parseDeviceActivationTicket(value: unknown): DeviceActivationTicket {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !(TICKET_KEYS as readonly string[]).includes(key))) return invalid();
  if (input.protocolVersion !== DEVICE_ACTION_PROTOCOL_VERSION
    || typeof input.sourceOrigin !== "string"
    || typeof input.actionId !== "string"
    || typeof input.nonce !== "string") return invalid();
  let sourceOrigin: string;
  try {
    sourceOrigin = normalizeDeviceActionOrigin(input.sourceOrigin);
  } catch {
    return invalid();
  }
  if (!isDeviceActionId(input.actionId) || input.actionId !== input.actionId.toLowerCase() || !isDeviceActionNonce(input.nonce)) return invalid();
  return {
    protocolVersion: DEVICE_ACTION_PROTOCOL_VERSION,
    sourceOrigin,
    actionId: input.actionId,
    nonce: input.nonce,
  };
}

export function createDeviceActivationUrl(ticket: DeviceActivationTicket): string {
  const canonical = parseDeviceActivationTicket(ticket);
  return `localapp://action/${canonical.actionId}?origin=${encodeURIComponent(canonical.sourceOrigin)}&nonce=${encodeURIComponent(canonical.nonce)}&protocolVersion=${canonical.protocolVersion}`;
}

export function parseDeviceActivationUrl(value: string): DeviceActivationTicket {
  if (typeof value !== "string" || value.length > 4096) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.protocol !== "localapp:" || url.hostname !== "action" || url.username || url.password || url.hash
    || !isDeviceActionId(url.pathname.slice(1)) || url.pathname !== `/${url.pathname.slice(1).toLowerCase()}`) return invalid();
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 3 || new Set(entries.map(([key]) => key)).size !== 3
    || !entries.every(([key]) => ["origin", "nonce", "protocolVersion"].includes(key))) return invalid();
  const protocolVersion = url.searchParams.get("protocolVersion");
  const origin = url.searchParams.get("origin");
  const nonce = url.searchParams.get("nonce");
  if (protocolVersion !== String(DEVICE_ACTION_PROTOCOL_VERSION) || origin === null || nonce === null) return invalid();
  return parseDeviceActivationTicket({
    protocolVersion: DEVICE_ACTION_PROTOCOL_VERSION,
    sourceOrigin: origin,
    actionId: url.pathname.slice(1),
    nonce,
  });
}
