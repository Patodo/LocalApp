import { describe, expect, it } from "vitest";
import {
  DeviceActionTrustStore,
  type DeviceActionTrustIdentity,
} from "../src/lib/device-action-trust-store.js";
import { canonicalizeDeviceActionPermissions } from "../src/lib/device-action-types.js";

const identity: DeviceActionTrustIdentity = {
  sourceOrigin: "https://market.example.test",
  appOwner: "market",
  appName: "skills",
  publisherUserId: "publisher",
  publisherDisplayName: "Publisher",
};

describe("device action trust", () => {
  it("reuses a grant only when the existing permission set contains the request", () => {
    const store = new DeviceActionTrustStore();
    const readOnly = canonicalizeDeviceActionPermissions({ filesystemRead: ["/work"] });
    const readWrite = canonicalizeDeviceActionPermissions({ filesystemRead: ["/work"], filesystemWrite: ["/work"] });
    store.grant(identity, readWrite);
    expect(store.find(identity, readOnly)?.permissions).toEqual(readWrite);
    expect(store.find(identity, { filesystemWrite: ["/other"] })).toBeNull();
  });

  it("requires an exact identity and supports revocation", () => {
    const store = new DeviceActionTrustStore();
    const permissions = canonicalizeDeviceActionPermissions({ filesystemWrite: ["/work"] });
    store.grant(identity, permissions);
    expect(store.list()).toHaveLength(1);
    expect(store.revoke(identity)).toBe(true);
    expect(store.find(identity, permissions)).toBeNull();
  });
});
