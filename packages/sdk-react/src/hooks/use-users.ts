import { useState, useEffect } from "react";
import { LocalAppError, type UserBasic } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseUsersResult {
  users: UserBasic[];
  loading: boolean;
  error: LocalAppError | null;
}

export function useUsers(): UseUsersResult {
  const [users, setUsers] = useState<UserBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getClient().users().then((data) => {
      if (!cancelled) { setUsers(data); setLoading(false); }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { users, loading, error };
}
