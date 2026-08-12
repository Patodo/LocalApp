import { validateNativeNotificationEnvelope, type NativeNotificationEnvelope, type NativePermissionState } from "../native/native-adapter.js";
import { DeliveryStore, validateDeliveryNotification, type DeliveryNotification, type PendingDelivery } from "./delivery-store.js";

export interface NotificationDisplayAdapter {
  permissionState(): Promise<NativePermissionState>;
  requestPermission?(): Promise<NativePermissionState>;
  showNotification(envelope: NativeNotificationEnvelope): Promise<void>;
}

export interface NotificationDispatcherOptions {
  store: DeliveryStore;
  adapter: NotificationDisplayAdapter;
  iconPath: string;
  now?: () => Date;
}

export interface NotificationDisplayPolicy {
  quietHours: { start: string; end: string; timeZone: string } | null;
  preview: "full" | "hidden";
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
  private readonly now: () => Date;
  private policy: NotificationDisplayPolicy = { quietHours: null, preview: "full" };

  constructor(options: NotificationDispatcherOptions) {
    if (options === null || typeof options !== "object" || !(options.store instanceof DeliveryStore)
      || options.adapter === null || typeof options.adapter !== "object"
      || typeof options.adapter.permissionState !== "function" || typeof options.adapter.showNotification !== "function") {
      throw new Error("Notification dispatcher options are invalid");
    }
    this.store = options.store;
    this.adapter = options.adapter;
    this.iconPath = validateNativeNotificationEnvelope({ identifier: "localapp_dispatcher_validation", ticket: "localapp_dispatcher_validation", title: "LocalApp", body: "", sourceLabel: "LocalApp", priority: "normal", iconPath: options.iconPath }).iconPath;
    this.now = options.now ?? (() => new Date());
  }

  configure(policy: NotificationDisplayPolicy): void {
    this.policy = validateDisplayPolicy(policy);
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const sourceId = validateSource(input.sourceId);
    const sourceLabel = validateSourceLabel(input.sourceLabel);
    if (input.policy !== "native" && input.policy !== "inbox-only") throw new Error("Notification delivery policy is invalid");
    const delivery = validateDeliveryNotification(input.delivery);
    prevalidateEnvelope(delivery, sourceLabel, this.iconPath);
    if (input.signal?.aborted) return { outcome: "aborted", sequence: delivery.sequence };

    const pending = await this.prepare(sourceId, sourceLabel, delivery);
    if (pending === null) return { outcome: "duplicate", sequence: delivery.sequence };
    if (pending === "inbox-only") return { outcome: "inbox-only", sequence: delivery.sequence };
    if (input.signal?.aborted) return { outcome: "aborted", sequence: delivery.sequence };

    if (input.policy === "inbox-only" || isQuietTime(this.policy.quietHours, this.now())) {
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
      title: this.policy.preview === "hidden" ? "New LocalApp notification" : pending.delivery.title,
      body: this.policy.preview === "hidden" ? `Open ${pending.sourceLabel} to view it` : pending.delivery.body ?? "",
      sourceLabel: pending.sourceLabel,
      priority: pending.delivery.priority,
      iconPath: pending.iconPath,
    });
    await this.adapter.showNotification(envelope);
    await this.store.commitShown(sourceId, delivery.sequence);
    return { outcome: "shown", sequence: delivery.sequence };
  }

  async dispatchSummary(input: SummaryInput): Promise<{ outcome: "shown" | "inbox-only" | "aborted" }> {
    const sourceId = validateSource(input.sourceId);
    const sourceLabel = validateSourceLabel(input.sourceLabel);
    if (!Number.isSafeInteger(input.omittedCount) || input.omittedCount < 1) {
      throw new Error("Notification summary count is invalid");
    }
    if (input.signal?.aborted) return { outcome: "aborted" };
    if (isQuietTime(this.policy.quietHours, this.now())) return { outcome: "inbox-only" };
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
      try { await this.store.consumeTicket(summary.ticket); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Notification summary display and ticket cleanup failed"); }
      throw error;
    }
    return { outcome: "shown" };
  }

  async sendTestNotification(commandId: string): Promise<{ result: "shown" | "denied" | "unsupported" | "failed"; permission: NativePermissionState }> {
    if (typeof commandId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(commandId)) throw new Error("Notification test command is invalid");
    let permission = await this.adapter.permissionState();
    if (permission === "not-determined") permission = this.adapter.requestPermission ? await this.adapter.requestPermission() : "unsupported";
    if (permission === "denied") return { result: "denied", permission };
    if (permission === "unsupported") return { result: "unsupported", permission };
    if (permission !== "granted") return { result: "failed", permission };
    await this.adapter.showNotification(validateNativeNotificationEnvelope({
      identifier: commandId,
      ticket: commandId,
      title: "LocalApp notifications are ready",
      body: "This computer can display LocalApp notifications.",
      sourceLabel: "This device",
      priority: "normal",
      iconPath: this.iconPath,
    }));
    return { result: "shown", permission };
  }

  private async prepare(sourceId: string, sourceLabel: string, delivery: DeliveryNotification): Promise<PendingDelivery | "inbox-only" | null> {
    const existing = await this.store.readPending(sourceId);
    if (existing !== null) {
      if (JSON.stringify(existing.delivery) !== JSON.stringify(delivery) || existing.sourceLabel !== sourceLabel || existing.iconPath !== this.iconPath) {
        throw new Error("Notification source already has a different pending delivery");
      }
      const retried = await this.store.retryPending(sourceId);
      return retried === "exhausted" ? "inbox-only" : retried;
    }
    return this.store.preparePending(sourceId, delivery, undefined, sourceLabel, this.iconPath);
  }
}

function prevalidateEnvelope(delivery: DeliveryNotification, sourceLabel: string, iconPath: string): void {
  validateNativeNotificationEnvelope({
    identifier: "localapp_pending_identifier_validation",
    ticket: "localapp_pending_ticket_validation",
    title: delivery.title,
    body: delivery.body ?? "",
    sourceLabel,
    priority: delivery.priority,
    iconPath,
  });
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

function validateDisplayPolicy(value: NotificationDisplayPolicy): NotificationDisplayPolicy {
  if (value === null || typeof value !== "object" || (value.preview !== "full" && value.preview !== "hidden")) throw new Error("Notification display policy is invalid");
  if (value.quietHours === null) return { quietHours: null, preview: value.preview };
  const quiet = value.quietHours;
  if (typeof quiet !== "object" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)
    || quiet.start === quiet.end || typeof quiet.timeZone !== "string" || quiet.timeZone.length > 64) throw new Error("Notification display policy is invalid");
  try { new Intl.DateTimeFormat("en-US", { timeZone: quiet.timeZone }).format(); } catch { throw new Error("Notification display policy is invalid"); }
  return { quietHours: { ...quiet }, preview: value.preview };
}

function isQuietTime(quiet: NotificationDisplayPolicy["quietHours"], now: Date): boolean {
  if (quiet === null) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: quiet.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  const start = clockMinutes(quiet.start);
  const end = clockMinutes(quiet.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function clockMinutes(value: string): number { const [hour, minute] = value.split(":").map(Number); return hour! * 60 + minute!; }
