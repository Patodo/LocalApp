import { validateNativeNotificationEnvelope, type NativeNotificationEnvelope, type NativePermissionState } from "../native/native-adapter.js";
import { DeliveryStore, validateDeliveryNotification, type DeliveryNotification, type PendingDelivery } from "./delivery-store.js";

export interface NotificationDisplayAdapter {
  permissionState(): Promise<NativePermissionState>;
  showNotification(envelope: NativeNotificationEnvelope): Promise<void>;
}

export interface NotificationDispatcherOptions {
  store: DeliveryStore;
  adapter: NotificationDisplayAdapter;
  iconPath: string;
}

export interface DispatchInput {
  sourceId: string;
  sourceLabel: string;
  policy: "native" | "inbox-only";
  delivery: DeliveryNotification;
  signal?: AbortSignal;
}

export type DispatchResult = {
  outcome: "shown" | "inbox-only" | "duplicate" | "aborted";
  sequence: number;
};

export interface SummaryInput {
  sourceId: string;
  sourceLabel: string;
  omittedCount: number;
  signal?: AbortSignal;
}

const SOURCE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,127})$/;

/** Serial source managers call this state machine; it never requests OS permission. */
export class NotificationDispatcher {
  private readonly store: DeliveryStore;
  private readonly adapter: NotificationDisplayAdapter;
  private readonly iconPath: string;

  constructor(options: NotificationDispatcherOptions) {
    this.store = options.store;
    this.adapter = options.adapter;
    this.iconPath = validateNativeNotificationEnvelope({ identifier: "localapp_dispatcher_validation", ticket: "localapp_dispatcher_validation", title: "LocalApp", body: "", sourceLabel: "LocalApp", priority: "normal", iconPath: options.iconPath }).iconPath;
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const sourceId = validateSource(input.sourceId);
    const sourceLabel = validateSourceLabel(input.sourceLabel);
    if (input.policy !== "native" && input.policy !== "inbox-only") throw new Error("Notification delivery policy is invalid");
    const delivery = validateDeliveryNotification(input.delivery);
    if (input.signal?.aborted) return { outcome: "aborted", sequence: delivery.sequence };

    const pending = await this.prepare(sourceId, delivery);
    if (pending === null) return { outcome: "duplicate", sequence: delivery.sequence };
    if (input.signal?.aborted) return { outcome: "aborted", sequence: delivery.sequence };

    if (input.policy === "inbox-only") {
      await this.store.commitInboxOnly(sourceId, delivery.sequence);
      return { outcome: "inbox-only", sequence: delivery.sequence };
    }
    const permission = await this.adapter.permissionState();
    if (input.signal?.aborted) return { outcome: "aborted", sequence: delivery.sequence };
    if (permission !== "granted") {
      await this.store.commitInboxOnly(sourceId, delivery.sequence);
      return { outcome: "inbox-only", sequence: delivery.sequence };
    }

    const envelope = validateNativeNotificationEnvelope({
      identifier: pending.nativeId,
      ticket: pending.ticket,
      title: delivery.title,
      body: delivery.body ?? "",
      sourceLabel,
      priority: delivery.priority,
      iconPath: this.iconPath,
    });
    await this.adapter.showNotification(envelope);
    await this.store.commitShown(sourceId, delivery.sequence);
    return { outcome: "shown", sequence: delivery.sequence };
  }

  async dispatchSummary(input: SummaryInput): Promise<{ outcome: "shown" | "inbox-only" | "aborted" }> {
    const sourceId = validateSource(input.sourceId);
    const sourceLabel = validateSourceLabel(input.sourceLabel);
    if (!Number.isSafeInteger(input.omittedCount) || input.omittedCount < 1 || input.omittedCount > 1_000_000) {
      throw new Error("Notification summary count is invalid");
    }
    if (input.signal?.aborted) return { outcome: "aborted" };
    if (await this.adapter.permissionState() !== "granted") return { outcome: "inbox-only" };
    if (input.signal?.aborted) return { outcome: "aborted" };
    const summary = await this.store.issueSummary(sourceId);
    const envelope = validateNativeNotificationEnvelope({
      identifier: summary.ticket,
      ticket: summary.ticket,
      title: `${input.omittedCount} new notifications`,
      body: `Open the ${sourceLabel} inbox`,
      sourceLabel,
      priority: "normal",
      iconPath: this.iconPath,
    });
    try {
      await this.adapter.showNotification(envelope);
    } catch (error) {
      await this.store.consumeTicket(summary.ticket).catch(() => undefined);
      throw error;
    }
    return { outcome: "shown" };
  }

  private async prepare(sourceId: string, delivery: DeliveryNotification): Promise<PendingDelivery | null> {
    const existing = await this.store.readPending(sourceId);
    if (existing !== null) {
      if (existing.delivery.id !== delivery.id || existing.delivery.sequence !== delivery.sequence) {
        throw new Error("Notification source already has a different pending delivery");
      }
      return this.store.retryPending(sourceId);
    }
    return this.store.preparePending(sourceId, delivery);
  }
}

function validateSource(value: string): string {
  if (typeof value !== "string" || !SOURCE_ID.test(value)) throw new Error("Notification source id is invalid");
  return value;
}

function validateSourceLabel(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f<>]/.test(value)) {
    throw new Error("Notification source label is invalid");
  }
  return value;
}
