import { randomUUID } from "node:crypto";
import {
  createPeerRecord,
  deletePeerRecord,
  getPeerRecord,
  listPeerRecords,
  updatePeerRecord,
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

  recordVerification(id: string, verification: PeerVerification): PeerPublic | null {
    const peer = getPeerRecord(id);
    if (!peer) return null;
    const updated = updatePeerRecord({
      ...peer,
      verifiedUserId: verification.user.id,
      verifiedUserName: verification.user.name,
      verifiedUserDisplayName: verification.user.displayName,
      protocolVersion: verification.protocolVersion,
      transferLimits: JSON.stringify(verification.transferLimits),
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return updated ? publicPeer(updated) : null;
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
