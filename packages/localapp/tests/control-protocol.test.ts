import { describe, expect, it } from "vitest";
import {
  CONTROL_FRAME_LIMIT_BYTES,
  encodeControlRequest,
  encodeControlResponse,
  parseControlRequestFrame,
  parseControlResponseFrame,
} from "../src/daemon/control-protocol.js";

describe("daemon control protocol", () => {
  it("round-trips the strict lifecycle request and status response surface", () => {
    for (const request of [
      { type: "status" as const },
      { type: "stop" as const },
      { type: "restart" as const },
      { type: "activation" as const, url: "localapp://notification/open?ticket=notification_ticket_0123456789" },
    ]) {
      expect(parseControlRequestFrame(encodeControlRequest(request))).toEqual(request);
    }

    const response = {
      ok: true as const,
      type: "status" as const,
      data: {
        bootId: "boot_0123456789abcdef",
        pid: 42,
        server: { status: "ready" as const, listenUrl: "http://127.0.0.1:43127" },
      },
    };
    expect(parseControlResponseFrame(encodeControlResponse(response))).toEqual(response);
  });

  it("rejects oversized, partial, duplicate, trailing, and invalid UTF-8 frames before dispatch", () => {
    const oversized = Buffer.concat([
      Buffer.from('{"type":"status","padding":"'),
      Buffer.alloc(CONTROL_FRAME_LIMIT_BYTES, 0x61),
      Buffer.from('"}\n'),
    ]);
    expectProtocolCode(() => parseControlRequestFrame(oversized), "IPC_MESSAGE_TOO_LARGE");
    expectProtocolCode(() => parseControlRequestFrame(Buffer.from('{"type":"status"}')), "IPC_FRAME_INCOMPLETE");
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from('{"type":"status"}\n{"type":"stop"}\n')),
      "IPC_MULTIPLE_FRAMES",
    );
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from('{"type":"status"}\ntrailing')),
      "IPC_TRAILING_DATA",
    );
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from([0x7b, 0x22, 0x74, 0x79, 0x70, 0x65, 0x22, 0x3a, 0xff, 0x7d, 0x0a])),
      "IPC_INVALID_UTF8",
    );
  });

  it("rejects unknown request types, fields, and non-object JSON", () => {
    expectProtocolCode(() => parseControlRequestFrame(Buffer.from('{"type":"shell"}\n')), "IPC_REQUEST_UNSUPPORTED");
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from('{"type":"status","command":"id"}\n')),
      "IPC_REQUEST_INVALID",
    );
    expectProtocolCode(() => parseControlRequestFrame(Buffer.from('[]\n')), "IPC_REQUEST_INVALID");
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from(`${JSON.stringify({ type: "activation", url: `localapp://notification/open?ticket=${"a".repeat(4_100)}` })}\n`)),
      "IPC_REQUEST_INVALID",
    );
  });

  it("rejects duplicate JSON keys at every object depth", () => {
    expectProtocolCode(
      () => parseControlRequestFrame(Buffer.from('{"type":"status","type":"stop"}\n')),
      "IPC_JSON_DUPLICATE_KEY",
    );
    expectProtocolCode(
      () => parseControlResponseFrame(Buffer.from('{"ok":true,"type":"status","data":{"bootId":"boot_0123456789abcdef","pid":1,"pid":2,"server":{"status":"ready","listenUrl":"http://127.0.0.1:43127"}}}\n')),
      "IPC_JSON_DUPLICATE_KEY",
    );
  });

  it("rejects malformed or credential-shaped public responses", () => {
    expectProtocolCode(
      () => parseControlResponseFrame(Buffer.from('{"ok":false,"code":"bad","message":"x"}\n')),
      "IPC_RESPONSE_INVALID",
    );
    expectProtocolCode(
      () => parseControlResponseFrame(Buffer.from('{"ok":true,"type":"status","data":{"bootId":"short","pid":1,"server":{"status":"ready","listenUrl":"http://evil.example"}}}\n')),
      "IPC_RESPONSE_INVALID",
    );
    expectProtocolCode(
      () => parseControlResponseFrame(Buffer.from('{"ok":true,"type":"stop","apiKey":"secret"}\n')),
      "IPC_RESPONSE_INVALID",
    );
  });
});

function expectProtocolCode(operation: () => unknown, code: string): void {
  expect(operation).toThrow(expect.objectContaining({ code }));
}
