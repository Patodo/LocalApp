export {
  claimDeviceAction,
  cleanupDesktopActions as cleanupDeviceActions,
  createDesktopAction as createDeviceAction,
  DESKTOP_ACTION_CLEANUP_INTERVAL_MS as DEVICE_ACTION_CLEANUP_INTERVAL_MS,
  DESKTOP_ACTION_ERROR_MAX_BYTES as DEVICE_ACTION_ERROR_MAX_BYTES,
  DESKTOP_ACTION_RESULT_MAX_BYTES as DEVICE_ACTION_RESULT_MAX_BYTES,
  DESKTOP_ACTION_TERMINAL_RETENTION_MS as DEVICE_ACTION_TERMINAL_RETENTION_MS,
  getDesktopActionSnapshot as getDeviceActionSnapshot,
  listPendingDesktopActions as listPendingDeviceActions,
  transitionDeviceAction,
  type ClaimDeviceActionResult,
  type CreateDesktopActionInput as CreateDeviceActionInput,
  type DesktopActionError as DeviceActionError,
  type DesktopActionRecord as DeviceActionRecord,
  type DesktopActionSnapshot as DeviceActionSnapshot,
  type DesktopActionStatus as DeviceActionStatus,
  type PendingDesktopAction as PendingDeviceAction,
  type TransitionDesktopActionResult as TransitionDeviceActionResult,
} from "./desktop-actions-db.js";

export type { RecoverableDesktopAction as RecoverableDeviceAction } from "./desktop-actions-db.js";
