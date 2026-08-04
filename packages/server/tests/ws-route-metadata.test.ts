import { describe, expect, it } from "vitest";
import {
  MAX_WS_INSTALLATION_ID_LENGTH,
  parseWsConnectionMetadata,
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
});
