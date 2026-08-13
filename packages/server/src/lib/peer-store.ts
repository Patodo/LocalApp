import { randomUUID } from "node:crypto";
import {
  createPeerRecord,
  deletePeerRecord,
  getPeerRecord,
  listPeerRecords,
  updatePeerRecord,
  updatePeerVerificationIfCurrent,
  type PeerRow,
} from "./meta-sqlite.js";
import { SecretBox } from "./secret-box.js";

export interface PeerPublic {
  id: string;
  name: string;
  baseUrl: string;
  acceptInsecureHttp: boolean;
  verifiedUser: { id: string; name: string; displayName: string | null } | null;
  protocolVersion: number | null;
  transferLimits: Record<string, number> | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePeerInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  acceptInsecureHttp: boolean;
}

export interface UpdatePeerInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  acceptInsecureHttp?: boolean;
}

export interface PeerVerification {
  user: { id: string; name: string; displayName: string | null };
  protocolVersion: number;
  transferLimits: Record<string, number>;
}

export type PeerCheckTarget = { id: string; baseUrl: string; apiKey: string; connectionVersion: number; verifiedUserId: string | null; protocolVersion: number | null };
export type RecordVerificationResult = { kind: "updated"; peer: PeerPublic } | { kind: "changed" | "missing" };

export class PeerStore {
  constructor(private readonly secretBox: SecretBox) {}

  create(input: CreatePeerInput): PeerPublic {
    const id = randomUUID();
    const now = new Date().toISOString();
    return publicPeer(createPeerRecord({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      credential: this.secretBox.seal(input.apiKey, id),
      acceptInsecureHttp: input.acceptInsecureHttp,
      connectionVersion: 1,
      verifiedUserId: null,
      verifiedUserName: null,
      verifiedUserDisplayName: null,
      protocolVersion: null,
      transferLimits: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  }

  listPublic(): PeerPublic[] {
    return listPeerRecords().map(publicPeer);
  }

  getPublic(id: string): PeerPublic | null {
    const peer = getPeerRecord(id);
    return peer ? publicPeer(peer) : null;
  }

  findIdByName(name: string): string | null {
    return this.listPublic().find((peer) => peer.name === name)?.id ?? null;
  }

  replaceCredential(id: string, apiKey: string): PeerPublic | null {
    return this.update(id, { apiKey });
  }

  update(id: string, input: UpdatePeerInput): PeerPublic | null {
    const current = getPeerRecord(id);
    if (!current) return null;
    const changedConnection = input.baseUrl !== undefined || input.apiKey !== undefined || input.acceptInsecureHttp !== undefined;
    const updated = updatePeerRecord({
      ...current,
      name: input.name ?? current.name,
      baseUrl: input.baseUrl ?? current.baseUrl,
      credential: input.apiKey === undefined ? current.credential : this.secretBox.seal(input.apiKey, id),
      acceptInsecureHttp: input.acceptInsecureHttp ?? current.acceptInsecureHttp,
      connectionVersion: changedConnection ? current.connectionVersion + 1 : current.connectionVersion,
      verifiedUserId: changedConnection ? null : current.verifiedUserId,
      verifiedUserName: changedConnection ? null : current.verifiedUserName,
      verifiedUserDisplayName: changedConnection ? null : current.verifiedUserDisplayName,
      protocolVersion: changedConnection ? null : current.protocolVersion,
      transferLimits: changedConnection ? null : current.transferLimits,
      verifiedAt: changedConnection ? null : current.verifiedAt,
      updatedAt: new Date().toISOString(),
    });
    return updated ? publicPeer(updated) : null;
  }

  remove(id: string): boolean {
    return deletePeerRecord(id);
  }

  loadCredential(id: string): string | null {
    const peer = getPeerRecord(id);
    return peer ? this.secretBox.open(peer.credential, peer.id) : null;
  }

  loadForCheck(id: string): PeerCheckTarget | null {
    const peer = getPeerRecord(id);
    return peer ? {
      id: peer.id,
      baseUrl: peer.baseUrl,
      apiKey: this.secretBox.open(peer.credential, peer.id),
      connectionVersion: peer.connectionVersion,
      verifiedUserId: peer.verifiedUserId,
      protocolVersion: peer.protocolVersion,
    } : null;
  }

  recordVerification(target: PeerCheckTarget, verification: PeerVerification): RecordVerificationResult {
    const now = new Date().toISOString();
    const result = updatePeerVerificationIfCurrent({
      id: target.id,
      connectionVersion: target.connectionVersion,
      verifiedUserId: verification.user.id,
      verifiedUserName: verification.user.name,
      verifiedUserDisplayName: verification.user.displayName,
      protocolVersion: verification.protocolVersion,
      transferLimits: JSON.stringify(verification.transferLimits),
      verifiedAt: now,
      updatedAt: now,
    });
    if (result !== "updated") return { kind: result };
    const peer = getPeerRecord(target.id);
    if (!peer) return { kind: "missing" };
    return { kind: "updated", peer: publicPeer(peer) };
  }
}

function publicPeer(peer: PeerRow): PeerPublic {
  return {
    id: peer.id,
    name: peer.name,
    baseUrl: peer.baseUrl,
    acceptInsecureHttp: peer.acceptInsecureHttp,
    verifiedUser: peer.verifiedUserId && peer.verifiedUserName
      ? { id: peer.verifiedUserId, name: peer.verifiedUserName, displayName: peer.verifiedUserDisplayName }
      : null,
    protocolVersion: peer.protocolVersion,
    transferLimits: peer.transferLimits ? JSON.parse(peer.transferLimits) as Record<string, number> : null,
    verifiedAt: peer.verifiedAt,
    createdAt: peer.createdAt,
    updatedAt: peer.updatedAt,
  };
}
