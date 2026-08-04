import { useState, useEffect } from "react";
import { LocalAppError, type GroupBasic } from "@localapp/sdk";
import { getClient } from "../client.js";

interface UseGroupsResult {
  groups: GroupBasic[];
  loading: boolean;
  error: LocalAppError | null;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<GroupBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalAppError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getClient().groups().then((data) => {
      if (!cancelled) { setGroups(data); setLoading(false); }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { groups, loading, error };
}
