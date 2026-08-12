import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeviceNotificationsApiError,
  getDeviceNotificationSettings,
  isDeviceNotificationGenerationConflict,
} from "@/lib/device-notifications-api";

describe("device notifications API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("discards untrusted response details from thrown and serialized errors", async () => {
    const canary = "never-serialize-this-api-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: "NEVER_SERIALIZE_THIS_API_KEY",
      error: canary,
      apiKey: canary,
    }), { status: 500, headers: { "Content-Type": "application/json" } })));

    const error = await getDeviceNotificationSettings().catch((cause) => cause);

    expect(error).toBeInstanceOf(DeviceNotificationsApiError);
    expect(error).toMatchObject({ status: 500, code: null });
    expect(error.message).toBe("设备通知请求失败（HTTP 500）");
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(String(error)).not.toContain(canary);
  });

  it("treats only the explicit generation error code as a refreshable conflict", () => {
    expect(isDeviceNotificationGenerationConflict(new DeviceNotificationsApiError(
      409,
      "DEVICE_NOTIFICATION_GENERATION_CONFLICT",
    ))).toBe(true);
    expect(isDeviceNotificationGenerationConflict(new DeviceNotificationsApiError(
      409,
      "DEVICE_NOTIFICATION_CAPABILITY_UNAVAILABLE",
    ))).toBe(false);
  });
});
