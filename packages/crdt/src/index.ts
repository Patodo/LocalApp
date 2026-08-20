import * as Y from "yjs";
import { detectBasePath } from "@localapp/sdk";

export const LOCALAPP_EDITING_AWARENESS_EVENT = "localapp:crdt-editing-awareness";

const REMOTE_ORIGIN = Symbol("localapp-crdt-remote");
const MAX_PENDING_UPDATE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_UPDATE_BYTES = 768 * 1024;

export type LocalAppCrdtStatus = "connecting" | "connected" | "offline" | "error" | "destroyed";

export interface EditingTarget {
  surfaceId: string;
  fieldId?: string;
  label?: string;
  kind?: "field" | "selection" | "canvas";
  selection?: { anchor: string; head: string };
}

export interface AwarenessUser {
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  color: string;
}

export interface EditingPeer {
  clientId: string;
  clock: number;
  user: AwarenessUser;
  editing: EditingTarget;
  overlay?: boolean;
  updatedAt: string;
}

export interface LocalAppCrdtOptions {
  resource: string;
  documentId: string;
  doc?: Y.Doc;
  basePath?: string;
  clientId?: string;
  autoConnect?: boolean;
  awareness?: boolean;
}

export interface LocalAppCrdtError {
  operation: "connect" | "sync" | "update" | "awareness";
  error: Error;
}

type StatusListener = (status: LocalAppCrdtStatus) => void;
type AwarenessListener = (peers: EditingPeer[]) => void;
type ErrorListener = (error: LocalAppCrdtError) => void;

export class LocalAppCrdtProvider {
  readonly doc: Y.Doc;
  readonly resource: string;
  readonly documentId: string;
  readonly clientId: string;

  private readonly basePath: string;
  private readonly awarenessEnabled: boolean;
  private readonly sourceId: string;
  private eventSource: EventSource | null = null;
  private heartbeatTimer: number | null = null;
  private retryTimer: number | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private sending = false;
  private destroyed = false;
  private listeningForDocumentUpdates = false;
  private initialDocumentStateQueued = false;
  private awarenessClock = 0;
  private awarenessLeaseActive = false;
  private editingTarget: EditingTarget | null = null;
  private peers: EditingPeer[] = [];
  private currentStatus: LocalAppCrdtStatus = "offline";
  private readonly statusListeners = new Set<StatusListener>();
  private readonly awarenessListeners = new Set<AwarenessListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  constructor(options: LocalAppCrdtOptions) {
    this.resource = requireIdentifier(options.resource, "resource");
    this.documentId = requireDocumentId(options.documentId);
    this.doc = options.doc ?? new Y.Doc();
    this.basePath = (options.basePath ?? detectBasePath()).replace(/\/+$/, "");
    this.clientId = options.clientId ?? createClientId();
    this.sourceId = `${this.resource}:${this.documentId}:${this.clientId}`;
    this.awarenessEnabled = options.awareness !== false;
    if (options.autoConnect !== false) void this.connect();
  }

  get status(): LocalAppCrdtStatus {
    return this.currentStatus;
  }

  get awareness(): readonly EditingPeer[] {
    return this.peers;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  onAwareness(listener: AwarenessListener): () => void {
    this.awarenessListeners.add(listener);
    listener(this.peers);
    return () => this.awarenessListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.destroyed || this.eventSource) return;
    this.startDocumentUpdates();
    this.queueInitialDocumentState();
    this.setStatus("connecting");
    if (typeof EventSource !== "undefined") {
      const query = new URLSearchParams({
        resource: this.resource,
        documentId: this.documentId,
        clientId: this.clientId,
      });
      this.eventSource = new EventSource(`${this.basePath}/crdt/events?${query}`);
      this.eventSource.addEventListener("crdt:update", this.handleRemoteUpdate as EventListener);
      this.eventSource.addEventListener("crdt:awareness", this.handleAwarenessSnapshot as EventListener);
      this.eventSource.addEventListener("open", this.handleEventSourceOpen as EventListener);
      this.eventSource.addEventListener("error", this.handleEventSourceError as EventListener);
    }
    try {
      await this.synchronize();
      this.setStatus("connected");
      this.startHeartbeat();
      await this.flushUpdates();
      if (this.editingTarget) await this.sendAwareness();
    } catch (error) {
      this.report("connect", error);
      this.setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      this.scheduleRetry();
    }
  }

  setEditingTarget(target: EditingTarget | null): void {
    this.editingTarget = target ? normalizeEditingTarget(target) : null;
    this.awarenessClock += 1;
    if (!this.destroyed && this.awarenessEnabled && this.currentStatus === "connected") void this.sendAwareness();
  }

  async synchronize(): Promise<void> {
    const response = await fetch(`${this.basePath}/crdt/sync`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource: this.resource,
        documentId: this.documentId,
        stateVector: encodeBase64Url(Y.encodeStateVector(this.doc)),
      }),
    });
    const body = await readJson(response);
    if (!response.ok || body.success !== true || typeof body.data?.update !== "string") {
      throw new Error(body.error ?? `CRDT sync failed with HTTP ${response.status}`);
    }
    const update = decodeBase64Url(body.data.update);
    if (update.byteLength > 0) Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.listeningForDocumentUpdates) this.doc.off("update", this.handleDocumentUpdate);
    this.listeningForDocumentUpdates = false;
    this.eventSource?.close();
    this.eventSource = null;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.heartbeatTimer = null;
    this.retryTimer = null;
    if (this.awarenessEnabled && this.awarenessLeaseActive) {
      this.awarenessClock += 1;
      await this.sendAwareness(true).catch(() => {});
    }
    this.peers = [];
    this.publishAwareness();
    this.setStatus("destroyed");
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.destroyed) return;
    this.pendingUpdates.push(update);
    const pendingBytes = this.pendingUpdates.reduce((total, item) => total + item.byteLength, 0);
    if (pendingBytes > MAX_PENDING_UPDATE_BYTES) {
      this.pendingUpdates = [Y.mergeUpdates(this.pendingUpdates)];
    }
    if (this.currentStatus === "connected") void this.flushUpdates();
  };

  private startDocumentUpdates(): void {
    if (this.listeningForDocumentUpdates) return;
    this.doc.on("update", this.handleDocumentUpdate);
    this.listeningForDocumentUpdates = true;
  }

  private queueInitialDocumentState(): void {
    if (this.initialDocumentStateQueued) return;
    this.initialDocumentStateQueued = true;
    const update = Y.encodeStateAsUpdate(this.doc);
    // An empty Y.Doc encodes as a two-byte no-op update.
    if (update.byteLength > 2) this.pendingUpdates.push(update);
  }

  private readonly handleRemoteUpdate = (event: MessageEvent) => {
    try {
      const body = JSON.parse(event.data) as { data?: { update?: unknown } };
      if (typeof body.data?.update !== "string") return;
      Y.applyUpdate(this.doc, decodeBase64Url(body.data.update), REMOTE_ORIGIN);
    } catch (error) {
      this.report("update", error);
    }
  };

  private readonly handleAwarenessSnapshot = (event: MessageEvent) => {
    try {
      const body = JSON.parse(event.data) as { data?: { peers?: unknown } };
      const peers = Array.isArray(body.data?.peers)
        ? body.data.peers.filter(isEditingPeer).filter((peer) => peer.clientId !== this.clientId)
        : [];
      this.peers = peers;
      this.publishAwareness();
    } catch (error) {
      this.report("awareness", error);
    }
  };

  private readonly handleEventSourceOpen = () => {
    if (this.destroyed) return;
    void this.synchronize()
      .then(async () => {
        this.setStatus("connected");
        this.startHeartbeat();
        await this.flushUpdates();
        if (this.editingTarget) await this.sendAwareness();
      })
      .catch((error) => this.report("sync", error));
  };

  private readonly handleEventSourceError = () => {
    if (!this.destroyed) this.setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "connecting");
  };

  private async flushUpdates(): Promise<void> {
    if (this.sending || this.destroyed || this.pendingUpdates.length === 0) return;
    this.sending = true;
    try {
      while (!this.destroyed && this.pendingUpdates.length > 0) {
        const count = pendingBatchCount(this.pendingUpdates);
        const update = count === 1 ? this.pendingUpdates[0] : Y.mergeUpdates(this.pendingUpdates.slice(0, count));
        const response = await fetch(`${this.basePath}/crdt/update`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource: this.resource,
            documentId: this.documentId,
            clientId: this.clientId,
            update: encodeBase64Url(update),
          }),
        });
        const body = await readJson(response);
        if (!response.ok || body.success !== true) throw new Error(body.error ?? `CRDT update failed with HTTP ${response.status}`);
        this.pendingUpdates.splice(0, count);
      }
    } catch (error) {
      this.report("update", error);
      this.setStatus("offline");
      this.scheduleRetry();
    } finally {
      this.sending = false;
    }
  }

  private async sendAwareness(clear = false): Promise<void> {
    if (!this.awarenessEnabled) return;
    const response = await fetch(`${this.basePath}/crdt/awareness`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: clear,
      body: JSON.stringify({
        resource: this.resource,
        documentId: this.documentId,
        clientId: this.clientId,
        clock: this.awarenessClock,
        state: clear || !this.editingTarget ? null : { editing: this.editingTarget },
      }),
    });
    if (!response.ok) {
      const body = await readJson(response);
      const error = new Error(body.error ?? `CRDT awareness failed with HTTP ${response.status}`);
      this.report("awareness", error);
      return;
    }
    this.awarenessLeaseActive = !clear && this.editingTarget !== null;
  }

  private startHeartbeat(): void {
    if (!this.awarenessEnabled || this.heartbeatTimer !== null || typeof window === "undefined") return;
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.editingTarget || this.destroyed) return;
      this.awarenessClock += 1;
      void this.sendAwareness();
    }, 15_000);
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer !== null || typeof window === "undefined") return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.eventSource?.close();
      this.eventSource = null;
      void this.connect();
    }, 2_000);
  }

  private publishAwareness(): void {
    for (const listener of this.awarenessListeners) listener(this.peers);
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(new CustomEvent(LOCALAPP_EDITING_AWARENESS_EVENT, {
        detail: { sourceId: this.sourceId, peers: this.peers },
      }));
    }
  }

  private setStatus(status: LocalAppCrdtStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private report(operation: LocalAppCrdtError["operation"], value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value));
    for (const listener of this.errorListeners) listener({ operation, error });
  }
}

export function createLocalAppCrdt(options: LocalAppCrdtOptions): LocalAppCrdtProvider {
  return new LocalAppCrdtProvider(options);
}

export function encodeRelativePosition(position: Y.RelativePosition): string {
  return encodeBase64Url(Y.encodeRelativePosition(position));
}

export function decodeRelativePosition(value: string): Y.RelativePosition {
  return Y.decodeRelativePosition(decodeBase64Url(value));
}

export { Y };

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(normalized)) throw new Error(`Invalid CRDT ${label}`);
  return normalized;
}

function requireDocumentId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("Invalid CRDT documentId");
  }
  return normalized;
}

function normalizeEditingTarget(target: EditingTarget): EditingTarget {
  const surfaceId = requireIdentifier(target.surfaceId, "surfaceId");
  const fieldId = target.fieldId === undefined ? undefined : requireIdentifier(target.fieldId, "fieldId");
  const label = target.label?.trim().slice(0, 80) || undefined;
  const kind = target.kind ?? "field";
  if (!["field", "selection", "canvas"].includes(kind)) throw new Error("Invalid CRDT editing target kind");
  const selection = target.selection;
  if (selection && (selection.anchor.length > 2048 || selection.head.length > 2048)) {
    throw new Error("Invalid CRDT editing target selection");
  }
  return {
    surfaceId,
    ...(fieldId ? { fieldId } : {}),
    ...(label ? { label } : {}),
    kind,
    ...(selection ? { selection } : {}),
  };
}

function createClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url payload");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readJson(response: Response): Promise<any> {
  try { return await response.json(); }
  catch { return { success: false, error: `HTTP ${response.status}` }; }
}

function isEditingPeer(value: unknown): value is EditingPeer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const peer = value as Record<string, any>;
  return typeof peer.clientId === "string"
    && typeof peer.clock === "number"
    && typeof peer.updatedAt === "string"
    && peer.user && typeof peer.user.id === "string" && typeof peer.user.color === "string"
    && peer.editing && typeof peer.editing.surfaceId === "string";
}

function pendingBatchCount(updates: Uint8Array[]): number {
  let bytes = 0;
  let count = 0;
  for (const update of updates) {
    if (count > 0 && bytes + update.byteLength > MAX_BATCH_UPDATE_BYTES) break;
    bytes += update.byteLength;
    count += 1;
    if (bytes >= MAX_BATCH_UPDATE_BYTES) break;
  }
  return Math.max(1, count);
}
