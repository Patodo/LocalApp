import { describe, expect, it } from "vitest";
import {
  createDeviceActivationUrl,
  parseDeviceActivationUrl,
  parseDeviceActivationTicket,
} from "../src/lib/device-action-ticket.js";

const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const TICKET = {
  protocolVersion: 2,
  sourceOrigin: "https://server.example.test",
  actionId: ACTION_ID,
  nonce: "nonce_abcdefghijklmnopqrstuvwxyz-0123456789",
};

describe("device activation ticket", () => {
  it("round trips the canonical localapp URL without executable data", () => {
    const url = createDeviceActivationUrl(TICKET);
    expect(url).toBe(
      `localapp://action/${ACTION_ID}?origin=https%3A%2F%2Fserver.example.test&nonce=${TICKET.nonce}&protocolVersion=2`,
    );
    expect(parseDeviceActivationUrl(url)).toEqual(TICKET);
    expect(url).not.toContain("script");
    expect(url).not.toContain("dependencies");
  });

  it("rejects extra query fields and executable or credential payloads", () => {
    expect(() => parseDeviceActivationUrl(`${createDeviceActivationUrl(TICKET)}&script=alert(1)`)).toThrow(
      "DEVICE_ACTION_INVALID_TICKET",
    );
    expect(() => parseDeviceActivationTicket({ ...TICKET, script: "alert(1)" })).toThrow(
      "DEVICE_ACTION_INVALID_TICKET",
    );
    expect(() => parseDeviceActivationTicket({ ...TICKET, sourceOrigin: "http://127.0.0.1:3000/path" })).toThrow(
      "DEVICE_ACTION_INVALID_TICKET",
    );
  });
});
