export type DeviceNotificationPermission = "not-determined" | "granted" | "denied" | "unsupported" | "unknown";
export type DeviceNotificationPreview = "full" | "hidden";
export type DeviceNotificationConnectionState = "disabled" | "pending" | "connecting" | "connected" | "error";

export interface DeviceNotificationQuietHours {
  start: string;
  end: string;
  timeZone: string;
}

export interface DeviceNotificationSettings {
  quietHours: DeviceNotificationQuietHours | null;
  preview: DeviceNotificationPreview;
}

export interface DeviceNotificationSource {
  id: string;
  peerId?: string;
  kind: "local" | "peer";
  sourceLabel: string;
  accountLabel: string;
  desiredEnabled: boolean;
  capability: { available: boolean; reason: string | null };
  connectionState: DeviceNotificationConnectionState;
  cursor: number | null;
  lastEventAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceNotificationTest {
  id: string;
  state: string;
  result: string | null;
}

export interface DeviceNotificationsSnapshot {
  deviceIntegration: { available: boolean };
  generation: number;
  sources: DeviceNotificationSource[];
  availablePeers?: Array<{ peerId: string; sourceLabel: string; accountLabel: string }>;
}

export interface DeviceNotificationSettingsSnapshot {
  deviceIntegration: { available: boolean };
  generation: number;
  settings: DeviceNotificationSettings;
  native: {
    permission: DeviceNotificationPermission;
    daemonVersion: string | null;
    adapterVersion: string | null;
    updatedAt: string | null;
  };
  lastTest: DeviceNotificationTest | null;
}

export type DeviceNotificationSettingsMutation = Omit<DeviceNotificationSettingsSnapshot, "deviceIntegration">;

export interface DeviceNotificationSourceMutation {
  generation: number;
  source: DeviceNotificationSource;
}

const PUBLIC_ERROR_CODES = new Set(["DEVICE_NOTIFICATION_GENERATION_CONFLICT"]);

export class DeviceNotificationsApiError extends Error {
  readonly code: string | null;

  constructor(readonly status: number, code: unknown) {
    super(status === 409
      ? "设备通知设置版本冲突"
      : `设备通知请求失败（HTTP ${status}）`);
    this.name = "DeviceNotificationsApiError";
    this.code = typeof code === "string" && PUBLIC_ERROR_CODES.has(code) ? code : null;
  }
}

export function isDeviceNotificationGenerationConflict(error: unknown): boolean {
  return error instanceof DeviceNotificationsApiError
    && error.status === 409
    && error.code === "DEVICE_NOTIFICATION_GENERATION_CONFLICT";
}

async function requestData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  const body = await response.json().catch(() => null) as unknown;
  const record = isRecord(body) ? body : null;
  if (!response.ok || record?.success !== true || !("data" in (record ?? {}))) {
    throw new DeviceNotificationsApiError(response.status, record?.code);
  }
  return record.data as T;
}

function jsonMutation(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function getDeviceNotifications(): Promise<DeviceNotificationsSnapshot> {
  return requestData("/api/device-notifications");
}

export function getDeviceNotificationSettings(): Promise<DeviceNotificationSettingsSnapshot> {
  return requestData("/api/device-notifications/settings");
}

export function updateDeviceNotificationSettings(
  generation: number,
  settings: DeviceNotificationSettings,
): Promise<DeviceNotificationSettingsMutation> {
  return requestData(
    "/api/device-notifications/settings",
    jsonMutation("PUT", { generation, settings }),
  );
}

export function enableLocalDeviceNotificationSource(
  generation: number,
  label = "此 Server",
): Promise<DeviceNotificationSourceMutation> {
  return requestData(
    "/api/device-notifications/local/enable",
    jsonMutation("POST", { generation, label }),
  );
}

export function enablePeerDeviceNotificationSource(
  peerId: string,
  generation: number,
  label: string,
): Promise<DeviceNotificationSourceMutation> {
  return requestData(
    `/api/device-notifications/peers/${encodeURIComponent(peerId)}/enable`,
    jsonMutation("POST", { generation, label }),
  );
}

export function enableDeviceNotificationSource(
  source: DeviceNotificationSource,
  generation: number,
): Promise<DeviceNotificationSourceMutation> {
  if (source.kind === "local") {
    return enableLocalDeviceNotificationSource(generation, source.sourceLabel);
  }
  if (!source.peerId) {
    throw new DeviceNotificationsApiError(400, "DEVICE_NOTIFICATION_PEER_NOT_FOUND");
  }
  return enablePeerDeviceNotificationSource(source.peerId, generation, source.sourceLabel);
}

export function disableDeviceNotificationSource(
  sourceId: string,
  generation: number,
): Promise<DeviceNotificationSourceMutation> {
  return requestData(
    `/api/device-notifications/${encodeURIComponent(sourceId)}/disable`,
    jsonMutation("POST", { generation }),
  );
}

export function sendDeviceNotificationTest(generation: number): Promise<{
  generation: number;
  test: DeviceNotificationTest;
}> {
  return requestData(
    "/api/device-notifications/test",
    jsonMutation("POST", { generation }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
