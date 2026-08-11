import { describe, expect, it } from "vitest";
import {
  canonicalizeDeviceActionRequest,
  canonicalizeDeviceActionPermissions,
  deviceActionPermissionsDigest,
} from "../src/lib/device-action-types.js";

describe("device action source policy", () => {
  it("normalizes absolute permission roots and produces a stable digest", () => {
    const permissions = canonicalizeDeviceActionPermissions({
      filesystemWrite: ["/work/../work/output", "/work/output"],
      filesystemRead: ["/work/input/"],
      network: true,
    });
    expect(permissions).toEqual({
      filesystemRead: ["/work/input"],
      filesystemWrite: ["/work/output"],
      network: true,
    });
    expect(deviceActionPermissionsDigest(permissions)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires explicit permissions and rejects unbounded dependency specifications", () => {
    expect(() => canonicalizeDeviceActionRequest({
      title: "Install fixture",
      script: "return true",
      dependencies: { fixture: "^1.0.0" },
      permissions: {},
    })).toThrow("DEVICE_ACTION_INVALID_DEPENDENCY");
    expect(() => canonicalizeDeviceActionRequest({
      title: "Install fixture",
      script: "return true",
    })).toThrow("DEVICE_ACTION_PERMISSIONS_REQUIRED");
  });
});
