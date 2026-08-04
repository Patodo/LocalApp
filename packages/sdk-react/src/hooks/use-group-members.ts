import { useState, useEffect } from "react";
import { LocalAppError, type UserBasic } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseGroupMembersResult {
  members: UserBasic[];
  loading: boolean;
  error: LocalAppError | null;
}

export function useGroupMembers(groupId: string): UseGroupMembersResult {
  const [members, setMembers] = useState<UserBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getClient().groupMembers(groupId).then((data) => {
      if (!cancelled) { setMembers(data); setLoading(false); }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [groupId]);

  return { members, loading, error };
}
