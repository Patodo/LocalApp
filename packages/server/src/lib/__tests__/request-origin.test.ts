import { describe, expect, it } from "vitest";
import { requestPublicOrigin } from "../request-origin.js";

describe("requestPublicOrigin", () => {
  it("uses the first trusted forwarded protocol and host", () => {
    expect(requestPublicOrigin({
      protocol: "http",
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "work.example.com:60004, internal:3000",
      },
    })).toBe("https://work.example.com:60004");
  });

  it("falls back to the direct request protocol and host", () => {
    expect(requestPublicOrigin({
      protocol: "http",
      headers: { host: "localhost:3000" },
    })).toBe("http://localhost:3000");
  });

  it("ignores unsupported forwarded protocols", () => {
    expect(requestPublicOrigin({
      protocol: "http",
      headers: {
        host: "localhost:3000",
        "x-forwarded-proto": "javascript",
        "x-forwarded-host": "attacker.example",
      },
    })).toBe("http://localhost:3000");
  });
});
