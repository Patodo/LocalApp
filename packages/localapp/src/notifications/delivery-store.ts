import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface DeliveryNotification {
  id: string;
  sequence: number;
  app_owner: string;
  app_name: string;
  title: string;
  body: string | null;
  url: string | null;
  priority: "normal" | "high";
  created_at: string;
}

export interface PendingDelivery {
  delivery: DeliveryNotification;
  nativeId: string;
  ticket: string;
  ticketExpiresAt: string;
  retryCount: number;
}

export type ClickIntent =
  | { kind: "notification"; sourceId: string; notificationId: string }
  | { kind: "summary"; sourceId: string };

export interface DeliverySourceSnapshot {
  sourceId: string;
  cursor: number;
  pending: PendingDelivery | null;
}

export type DeliveryStoreFaultPoint = "before-rename" | "after-rename";

export interface DeliveryStoreOptions {
  statePath: string;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  fault?: (point: DeliveryStoreFaultPoint) => void | Promise<void>;
  dedupeLimit?: number;
  ticketLimit?: number;
  ticketTtlMs?: number;
}

interface DedupeRecord { id: string; sequence: number }
interface TicketRecord { hash: string; expiresAt: string; intent: ClickIntent }
interface SourceState {
  sourceId: string;
  cursor: number;
  pending: PendingDelivery | null;
  dedupe: DedupeRecord[];
  tickets: TicketRecord[];
}
interface StateDocument { version: 1; sources: SourceState[] }

const EMPTY_STATE: StateDocument = { version: 1, sources: [] };
const SOURCE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,127})$/;
const RECORD_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,255})$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MAX_RETRY = 100;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 4_096;

/**
 * Sole machine-local authority for notification cursor, pending, dedupe and
 * click-ticket state. Every mutation reloads and publishes one state image.
 */
export class DeliveryStore {
  readonly statePath: string;
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly fault?: DeliveryStoreOptions["fault"];
  private readonly dedupeLimit: number;
  private readonly ticketLimit: number;
  private readonly ticketTtlMs: number;
  private tail: Promise<void> = Promise.resolve();
  private poisoned = false;

  constructor(options: DeliveryStoreOptions) {
    this.statePath = path.resolve(options.statePath);
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
    this.fault = options.fault;
    this.dedupeLimit = boundedLimit(options.dedupeLimit, 2_000);
    this.ticketLimit = boundedLimit(options.ticketLimit, 1_000);
    this.ticketTtlMs = boundedTtl(options.ticketTtlMs, 24 * 60 * 60 * 1_000);
  }

  async readSource(sourceId: string): Promise<DeliverySourceSnapshot | null> {
    return this.serial(async () => {
      validateSourceId(sourceId);
      const source = (await this.read()).sources.find((candidate) => candidate.sourceId === sourceId);
      return source === undefined ? null : snapshot(source);
    });
  }

  async baseline(sourceId: string, cursor: number): Promise<DeliverySourceSnapshot> {
    return this.mutate((state) => {
      validateSourceId(sourceId);
      validateSequence(cursor);
      let source = state.sources.find((candidate) => candidate.sourceId === sourceId);
      if (source === undefined) {
        source = { sourceId, cursor, pending: null, dedupe: [], tickets: [] };
        state.sources.push(source);
        state.sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      } else if (source.cursor !== cursor) {
        throw new Error("Notification source is already baselined");
      }
      return snapshot(source);
    });
  }

  async preparePending(sourceId: string, value: DeliveryNotification, expiresAt?: Date): Promise<PendingDelivery> {
    return this.mutate((state) => {
      const source = requiredSource(state, sourceId);
      const delivery = validateDelivery(value);
      if (source.pending !== null) {
        if (source.pending.delivery.id === delivery.id && source.pending.delivery.sequence === delivery.sequence) {
          return clonePending(source.pending);
        }
        throw new Error("Notification source already has a pending delivery");
      }
      if (delivery.sequence !== source.cursor + 1) throw new Error("Notification delivery gap detected");
      if (source.dedupe.some((item) => item.id === delivery.id || item.sequence === delivery.sequence)) {
        throw new Error("Notification delivery was already committed");
      }
      const ticket = this.token();
      const nativeId = this.token(18);
      source.pending = {
        delivery,
        nativeId,
        ticket,
        ticketExpiresAt: canonicalFutureDate(expiresAt ?? new Date(this.now().getTime() + this.ticketTtlMs), this.now()),
        retryCount: 0,
      };
      return clonePending(source.pending);
    });
  }

  async readPending(sourceId: string): Promise<PendingDelivery | null> {
    return this.serial(async () => {
      validateSourceId(sourceId);
      const source = (await this.read()).sources.find((candidate) => candidate.sourceId === sourceId);
      return source?.pending === null || source?.pending === undefined ? null : clonePending(source.pending);
    });
  }

  async retryPending(sourceId: string): Promise<PendingDelivery | null> {
    return this.mutate((state) => {
      const source = requiredSource(state, sourceId);
      if (source.pending === null) return null;
      if (source.pending.retryCount >= MAX_RETRY) throw new Error("Notification retry limit exceeded");
      source.pending.retryCount += 1;
      return clonePending(source.pending);
    });
  }

  async commitShown(sourceId: string, sequence: number): Promise<void> {
    await this.mutate((state) => {
      const source = requiredPending(state, sourceId, sequence);
      const pending = source.pending!;
      const ticket: TicketRecord = {
        hash: sha256(pending.ticket),
        expiresAt: pending.ticketExpiresAt,
        intent: { kind: "notification", sourceId, notificationId: pending.delivery.id },
      };
      if (state.sources.some((candidate) => candidate.tickets.some((item) => item.hash === ticket.hash))) {
        throw new Error("Notification ticket hash collision");
      }
      commitPending(source);
      source.tickets.push(ticket);
      this.pruneState(state);
    });
  }

  async commitInboxOnly(sourceId: string, sequence: number): Promise<void> {
    await this.mutate((state) => {
      commitPending(requiredPending(state, sourceId, sequence));
      this.pruneState(state);
    });
  }

  async issueSummary(sourceId: string, expiresAt?: Date): Promise<{ ticket: string; expiresAt: string }> {
    return this.mutate((state) => {
      const source = requiredSource(state, sourceId);
      const ticket = this.token();
      const canonicalExpiry = canonicalFutureDate(expiresAt ?? new Date(this.now().getTime() + this.ticketTtlMs), this.now());
      const hash = sha256(ticket);
      if (state.sources.some((candidate) => candidate.tickets.some((item) => item.hash === hash))) {
        throw new Error("Notification ticket hash collision");
      }
      source.tickets.push({ hash, expiresAt: canonicalExpiry, intent: { kind: "summary", sourceId } });
      this.pruneState(state);
      return { ticket, expiresAt: canonicalExpiry };
    });
  }

  async consumeTicket(ticket: string): Promise<ClickIntent | null> {
    if (typeof ticket !== "string" || !TOKEN.test(ticket)) {
      return this.serial(async () => null);
    }
    return this.mutate((state) => {
      const hash = sha256(ticket);
      const now = this.now().getTime();
      for (const source of state.sources) {
        const index = source.tickets.findIndex((candidate) => candidate.hash === hash);
        if (index < 0) continue;
        const record = source.tickets[index]!;
        source.tickets.splice(index, 1);
        if (Date.parse(record.expiresAt) <= now) return null;
        return structuredClone(record.intent);
      }
      this.pruneState(state);
      return null;
    });
  }

  async disableSource(sourceId: string): Promise<void> {
    await this.mutate((state) => {
      validateSourceId(sourceId);
      state.sources = state.sources.filter((source) => source.sourceId !== sourceId);
    });
  }

  async prune(): Promise<void> {
    await this.mutate((state) => this.pruneState(state));
  }

  private async mutate<T>(operation: (state: StateDocument) => T): Promise<T> {
    return this.serial(async () => {
      const state = await this.read();
      const result = operation(state);
      await this.publish(validateState(state));
      return result;
    });
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.poisoned) throw new Error("Notification delivery store is poisoned");
      return operation();
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async read(): Promise<StateDocument> {
    await ensurePrivateParent(path.dirname(this.statePath));
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const before = await fs.lstat(this.statePath, { bigint: true });
      assertPrivateRegular(before, "Notification delivery state");
      handle = await fs.open(this.statePath, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat({ bigint: true });
      assertPrivateRegular(opened, "Notification delivery state");
      if (!sameIdentity(before, opened)) throw unsafe("Notification delivery state identity changed");
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_STATE_BYTES) throw new Error("Notification delivery state is invalid");
      return validateState(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (isCode(error, "ENOENT")) return structuredClone(EMPTY_STATE);
      if (error instanceof SyntaxError) throw new Error("Notification delivery state is invalid");
      if (isCode(error, "ELOOP")) throw unsafe("Notification delivery state path is unsafe");
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async publish(state: StateDocument): Promise<void> {
    const parent = path.dirname(this.statePath);
    const parentBefore = await privateDirectoryIdentity(parent);
    const existing = await optionalLstat(this.statePath);
    if (existing !== undefined) assertPrivateRegular(existing, "Notification delivery state");
    const temporary = path.join(parent, `.${path.basename(this.statePath)}.${process.pid}.${this.token(12)}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let tempIdentity: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    let renamed = false;
    try {
      const content = Buffer.from(`${JSON.stringify(state)}\n`);
      if (content.byteLength > MAX_STATE_BYTES) throw new Error("Notification delivery state is too large");
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(content);
      await handle.sync();
      const opened = await handle.stat({ bigint: true });
      assertPrivateRegular(opened, "Notification delivery temporary file");
      tempIdentity = await fs.lstat(temporary, { bigint: true });
      if (!sameIdentity(opened, tempIdentity)) throw unsafe("Notification delivery temporary identity changed");
      await handle.close();
      handle = undefined;
      if (!sameIdentity(parentBefore, await privateDirectoryIdentity(parent))) throw unsafe("Notification delivery parent was replaced");
      const current = await optionalLstat(this.statePath);
      if (!optionalSameIdentity(existing, current)) throw unsafe("Notification delivery state was replaced");
      await this.fault?.("before-rename");
      await fs.rename(temporary, this.statePath);
      renamed = true;
      try {
        await this.fault?.("after-rename");
        if (process.platform !== "win32") {
          const directory = await fs.open(parent, "r");
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } catch (error) {
        this.poisoned = true;
        throw new Error("Notification delivery durability is uncertain after rename", { cause: error });
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!renamed && tempIdentity !== undefined) {
        const current = await optionalLstat(temporary);
        if (current !== undefined && sameIdentity(tempIdentity, current)) await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private pruneState(state: StateDocument): void {
    const now = this.now().getTime();
    for (const source of state.sources) {
      source.dedupe = source.dedupe.slice(-this.dedupeLimit);
      source.tickets = source.tickets.filter((ticket) => Date.parse(ticket.expiresAt) > now).slice(-this.ticketLimit);
    }
  }

  private token(size = 32): string {
    const bytes = this.randomBytes(size);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== size) throw new Error("Notification random source returned invalid bytes");
    const token = bytes.toString("base64url");
    if (token.length < 16 || token.length > 256) throw new Error("Notification random token is invalid");
    return token;
  }
}

function commitPending(source: SourceState): void {
  const pending = source.pending!;
  if (pending.delivery.sequence !== source.cursor + 1) throw new Error("Notification delivery gap detected");
  source.cursor = pending.delivery.sequence;
  source.dedupe.push({ id: pending.delivery.id, sequence: pending.delivery.sequence });
  source.pending = null;
}

function requiredSource(state: StateDocument, sourceId: string): SourceState {
  validateSourceId(sourceId);
  const source = state.sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) throw new Error("Notification source was not baselined");
  return source;
}

function requiredPending(state: StateDocument, sourceId: string, sequence: number): SourceState {
  validateSequence(sequence);
  const source = requiredSource(state, sourceId);
  if (source.pending === null || source.pending.delivery.sequence !== sequence) throw new Error("Notification pending delivery does not match");
  return source;
}

function validateState(value: unknown): StateDocument {
  if (!record(value) || !exactKeys(value, ["version", "sources"]) || value.version !== 1 || !Array.isArray(value.sources)) invalidState();
  if (value.sources.length > 256) invalidState();
  const sources = value.sources.map(parseSource);
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) invalidState();
  const hashes = sources.flatMap((source) => source.tickets.map((ticket) => ticket.hash));
  if (new Set(hashes).size !== hashes.length) invalidState();
  return { version: 1, sources };
}

function parseSource(value: unknown): SourceState {
  if (!record(value) || !exactKeys(value, ["sourceId", "cursor", "pending", "dedupe", "tickets"]) || !Array.isArray(value.dedupe) || !Array.isArray(value.tickets)) invalidState();
  validateSourceId(value.sourceId);
  validateSequence(value.cursor);
  const cursor = value.cursor;
  if (value.dedupe.length > 2_000 || value.tickets.length > 1_000) invalidState();
  const dedupe = value.dedupe.map(parseDedupe);
  if (new Set(dedupe.map((item) => item.id)).size !== dedupe.length || new Set(dedupe.map((item) => item.sequence)).size !== dedupe.length
    || dedupe.some((item) => item.sequence > cursor)) invalidState();
  const pending = value.pending === null ? null : parsePending(value.pending);
  if (pending !== null && (pending.delivery.sequence !== cursor + 1 || dedupe.some((item) => item.id === pending.delivery.id))) invalidState();
  const tickets = value.tickets.map(parseTicket);
  if (tickets.some((ticket) => ticket.intent.sourceId !== value.sourceId)) invalidState();
  return { sourceId: value.sourceId, cursor, pending, dedupe, tickets };
}

function parsePending(value: unknown): PendingDelivery {
  if (!record(value) || !exactKeys(value, ["delivery", "nativeId", "ticket", "ticketExpiresAt", "retryCount"])
    || typeof value.nativeId !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value.nativeId)
    || typeof value.ticket !== "string" || !TOKEN.test(value.ticket)
    || typeof value.ticketExpiresAt !== "string" || !canonicalDate(value.ticketExpiresAt)
    || !Number.isSafeInteger(value.retryCount) || (value.retryCount as number) < 0 || (value.retryCount as number) > MAX_RETRY) invalidState();
  return { delivery: validateDelivery(value.delivery), nativeId: value.nativeId, ticket: value.ticket, ticketExpiresAt: value.ticketExpiresAt, retryCount: value.retryCount as number };
}

function parseDedupe(value: unknown): DedupeRecord {
  if (!record(value) || !exactKeys(value, ["id", "sequence"]) || typeof value.id !== "string" || !RECORD_ID.test(value.id)) invalidState();
  validateSequence(value.sequence);
  return { id: value.id, sequence: value.sequence };
}

function parseTicket(value: unknown): TicketRecord {
  if (!record(value) || !exactKeys(value, ["hash", "expiresAt", "intent"]) || typeof value.hash !== "string" || !HASH.test(value.hash)
    || typeof value.expiresAt !== "string" || !canonicalDate(value.expiresAt)) invalidState();
  return { hash: value.hash, expiresAt: value.expiresAt, intent: parseIntent(value.intent) };
}

function parseIntent(value: unknown): ClickIntent {
  if (!record(value) || typeof value.kind !== "string") invalidState();
  if (value.kind === "summary" && exactKeys(value, ["kind", "sourceId"])) {
    validateSourceId(value.sourceId);
    return { kind: "summary", sourceId: value.sourceId };
  }
  if (value.kind === "notification" && exactKeys(value, ["kind", "sourceId", "notificationId"]) && typeof value.notificationId === "string" && RECORD_ID.test(value.notificationId)) {
    validateSourceId(value.sourceId);
    return { kind: "notification", sourceId: value.sourceId, notificationId: value.notificationId };
  }
  invalidState();
}

function validateDelivery(value: unknown): DeliveryNotification {
  if (!record(value) || !exactKeys(value, ["id", "sequence", "app_owner", "app_name", "title", "body", "url", "priority", "created_at"])
    || typeof value.id !== "string" || !RECORD_ID.test(value.id) || typeof value.app_owner !== "string" || typeof value.app_name !== "string"
    || typeof value.title !== "string" || value.title.length < 1 || !safeText(value.title)
    || (value.body !== null && (typeof value.body !== "string" || !safeText(value.body)))
    || (value.url !== null && (typeof value.url !== "string" || !safeRelativeUrl(value.url)))
    || (value.priority !== "normal" && value.priority !== "high") || typeof value.created_at !== "string" || !canonicalDate(value.created_at)) {
    throw new Error("Notification delivery serializer is invalid");
  }
  validateSequence(value.sequence);
  if (!safeName(value.app_owner) || !safeName(value.app_name)) throw new Error("Notification delivery serializer is invalid");
  return { id: value.id, sequence: value.sequence, app_owner: value.app_owner, app_name: value.app_name, title: value.title, body: value.body, url: value.url, priority: value.priority, created_at: value.created_at };
}

function safeRelativeUrl(value: string): boolean {
  if (value.length < 1 || value.length > 2_048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/%(?:2f|5c|00|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  try {
    const parsed = new URL(value, "http://localapp.invalid");
    return parsed.origin === "http://localapp.invalid" && parsed.username === "" && parsed.password === ""
      && `${parsed.pathname}${parsed.search}${parsed.hash}` === value && !parsed.pathname.split("/").includes("..");
  } catch { return false; }
}

function safeText(value: string): boolean {
  return value.length <= MAX_TEXT && !/[\u0000-\u001f\u007f<>]/.test(value);
}
function safeName(value: string): boolean { return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value); }
function validateSourceId(value: unknown): asserts value is string { if (typeof value !== "string" || !SOURCE_ID.test(value)) throw new Error("Notification source id is invalid"); }
function validateSequence(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_SEQUENCE) throw new Error("Notification sequence is invalid"); }
function canonicalDate(value: string): boolean { const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value; }
function canonicalFutureDate(value: Date, now: Date): string { if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value.getTime() <= now.getTime()) throw new Error("Notification ticket expiry is invalid"); return value.toISOString(); }
function clonePending(value: PendingDelivery): PendingDelivery { return structuredClone(value); }
function snapshot(source: SourceState): DeliverySourceSnapshot { return { sourceId: source.sourceId, cursor: source.cursor, pending: source.pending === null ? null : clonePending(source.pending) }; }
function sha256(value: string): string { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function invalidState(): never { throw new Error("Notification delivery state is invalid"); }
function unsafe(message: string): Error { return new Error(`${message} (unsafe)`); }
function boundedLimit(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value < 1 || value > fallback) throw new Error("Notification retention limit is invalid"); return value; }
function boundedTtl(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value < 1_000 || value > fallback) throw new Error("Notification ticket TTL is invalid"); return value; }
function isCode(error: unknown, code: string): boolean { return record(error) && error.code === code; }

async function ensurePrivateParent(directory: string): Promise<void> {
  const existing = await optionalLstat(directory);
  if (existing === undefined) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await fs.chmod(directory, 0o700);
  }
  await privateDirectoryIdentity(directory);
}

async function privateDirectoryIdentity(directory: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.nlink < 1n) throw unsafe("Notification delivery parent path is unsafe");
  if (process.platform !== "win32" && ((BigInt(stat.mode) & 0o777n) !== 0o700n || BigInt(stat.uid) !== BigInt(process.getuid?.() ?? Number(stat.uid)))) throw unsafe("Notification delivery parent permissions are unsafe");
  return stat;
}

function assertPrivateRegular(stat: Awaited<ReturnType<typeof fs.lstat>>, label: string): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw unsafe(`${label} path is unsafe`);
  if (process.platform !== "win32" && ((BigInt(stat.mode) & 0o777n) !== 0o600n || BigInt(stat.uid) !== BigInt(process.getuid?.() ?? Number(stat.uid)))) throw unsafe(`${label} permissions are unsafe`);
}
function sameIdentity(a: Awaited<ReturnType<typeof fs.lstat>>, b: Awaited<ReturnType<typeof fs.lstat>>): boolean { return a.dev === b.dev && a.ino === b.ino; }
function optionalSameIdentity(a: Awaited<ReturnType<typeof fs.lstat>> | undefined, b: Awaited<ReturnType<typeof fs.lstat>> | undefined): boolean { return a === undefined ? b === undefined : b !== undefined && sameIdentity(a, b); }
async function optionalLstat(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> { try { return await fs.lstat(target, { bigint: true }); } catch (error) { if (isCode(error, "ENOENT")) return undefined; throw error; } }
