import type { IssueUserIdentity } from "./issue-types";

export function resolveIssueIdentity(
  userId: string,
  users: readonly IssueUserIdentity[],
): IssueUserIdentity & { displayName: string; avatarUrl: string | null } {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const user = usersById.get(userId);
  if (!user) {
    return {
      id: userId,
      displayName: userId || "未知用户",
      avatarUrl: null,
    };
  }

  return {
    ...user,
    displayName: user.displayName?.trim() || user.name?.trim() || user.id || "未知用户",
    avatarUrl: user.avatarUrl || null,
  };
}

export function initialForIdentity(identity: IssueUserIdentity): string {
  if (!identity.id.trim()) return "?";
  const label = identity.displayName?.trim() || identity.name?.trim() || identity.id.trim();
  return label ? Array.from(label)[0].toLocaleUpperCase() : "?";
}
