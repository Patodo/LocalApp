import { describe, expect, it } from "vitest";
import {
  buildWsReadyMessage,
  MAX_WS_INSTALLATION_ID_LENGTH,
  parseWsConnectionMetadata,
  shouldSendLegacyMissed,
} from "../src/routes/ws.js";

describe("WebSocket route metadata parsing", () => {
  it("defaults old clients to generic metadata", () => {
    expect(parseWsConnectionMetadata(undefined)).toEqual({ clientKind: "generic" });
    expect(parseWsConnectionMetadata({})).toEqual({ clientKind: "generic" });
    expect(parseWsConnectionMetadata({ client: "cli", protocolVersion: "1" })).toEqual({
      clientKind: "generic",
    });
  });

  it("accepts the exact supported desktop protocol and bounded installation id", () => {
    expect(parseWsConnectionMetadata({
      client: "desktop",
      protocolVersion: "1",
      installationId: "install-a",
    })).toEqual({
      clientKind: "desktop",
      protocolVersion: 1,
      installationId: "install-a",
    });

    const maxLengthId = "a".repeat(MAX_WS_INSTALLATION_ID_LENGTH);
    expect(parseWsConnectionMetadata({ client: "desktop", installationId: maxLengthId })).toEqual({
      clientKind: "desktop",
      installationId: maxLengthId,
    });
  });

  it.each(["01", "1.0", " 1", "2", "0", "-1", "NaN"])(
    "does not accept unsupported or non-exact protocolVersion %s",
    (protocolVersion) => {
      expect(parseWsConnectionMetadata({ client: "desktop", protocolVersion })).toEqual({
        clientKind: "desktop",
      });
    },
  );

  it("ignores empty, oversized, and non-string installation ids", () => {
    for (const installationId of [
      "",
      "   ",
      "a".repeat(MAX_WS_INSTALLATION_ID_LENGTH + 1),
      ["install-a"],
      123,
    ]) {
      expect(parseWsConnectionMetadata({ client: "desktop", installationId })).toEqual({
        clientKind: "desktop",
      });
    }
  });

  it("does not trust array or non-string client markers", () => {
    expect(parseWsConnectionMetadata({ client: ["desktop"] })).toEqual({ clientKind: "generic" });
    expect(parseWsConnectionMetadata({ client: true })).toEqual({ clientKind: "generic" });
  });

  it("negotiates notification protocol 2 independently from Desktop Action protocol", () => {
    const daemon = parseWsConnectionMetadata({
      client: "notification-daemon",
      notificationProtocolVersion: "2",
      protocolVersion: "1",
      installationId: "must-not-become-desktop",
    });
    expect(daemon).toEqual({ clientKind: "notification-daemon", notificationProtocolVersion: 2 });
    expect(buildWsReadyMessage("alice", daemon, 42)).toEqual({
      type: "bus:ready",
      data: { userId: "alice", notificationProtocolVersion: 2, latestSequence: 42 },
    });
    expect(shouldSendLegacyMissed(daemon)).toBe(false);

    const desktop = parseWsConnectionMetadata({ client: "desktop", protocolVersion: "1" });
    expect(buildWsReadyMessage("alice", desktop, 42)).toEqual({
      type: "bus:ready",
      data: { userId: "alice" },
    });
    expect(shouldSendLegacyMissed(desktop)).toBe(true);
  });

  it.each([undefined, "", "02", "2.0", " 2", "3", ["2"]])(
    "does not negotiate alternate notification protocol form %j",
    (notificationProtocolVersion) => {
      expect(parseWsConnectionMetadata({ client: "notification-daemon", notificationProtocolVersion }))
        .toEqual({ clientKind: "generic" });
    },
  );
});
