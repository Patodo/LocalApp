import { describe, expect, it } from "vitest";
import { parseActivationUrl } from "../src/activation/activation-url.js";

const actionId = "11111111-1111-4111-8111-111111111111";
const nonce = "nonce_abcdefghijklmnopqrstuvwxyz-0123456789";
const deviceUrl = `localapp://action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`;

describe("strict localapp Scheme activation URLs", () => {
  it("returns only canonical Device Action ticket fields", () => {
    expect(parseActivationUrl(deviceUrl)).toEqual({
      kind: "device-action",
      ticket: {
        protocolVersion: 2,
        sourceOrigin: "https://server.example.test",
        actionId,
        nonce,
      },
    });
  });

  it("accepts an opaque notification ticket without exposing a target URL", () => {
    expect(parseActivationUrl("localapp://notification/open?ticket=notification_ticket_0123456789")).toEqual({
      kind: "notification",
      ticket: "notification_ticket_0123456789",
    });
  });

  it.each([
    "LOCALAPP://action/11111111-1111-4111-8111-111111111111?origin=https%3A%2F%2Fserver.example.test&nonce=nonce_abcdefghijklmnopqrstuvwxyz-0123456789&protocolVersion=2",
    `localapp://ACTION/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`,
    `localapp://action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2#fragment`,
    `localapp://user@action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`,
    `localapp://action:77/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`,
    `localapp://action/${actionId}%2Fchild?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`,
    `localapp://action/a/../${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`,
    `localapp://action/${actionId}?nonce=${nonce}&origin=https%3A%2F%2Fserver.example.test&protocolVersion=2`,
    `localapp://action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=02`,
    `localapp://action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2&script=alert(1)`,
    `localapp://notification/open?ticket=notification_ticket_0123456789&url=https%3A%2F%2Fevil.example`,
    "localapp://notification/Open?ticket=notification_ticket_0123456789",
    "localapp://notification/open?ticket=",
  ])("rejects noncanonical or executable data: %s", (value) => {
    expect(() => parseActivationUrl(value)).toThrow(/ACTIVATION_URL_INVALID/);
  });

  it("applies the 4096 UTF-8 byte limit before parsing", () => {
    const oversized = `${deviceUrl}&padding=${"界".repeat(1_400)}`;
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(4096);
    expect(() => parseActivationUrl(oversized)).toThrow(/ACTIVATION_URL_INVALID/);
  });
});
