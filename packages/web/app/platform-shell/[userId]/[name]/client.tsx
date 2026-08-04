"use client";

import { useParams } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { PlatformShell } from "@/components/shell/platform-shell";

function paramFromPath(key: "userId" | "name"): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/platform-shell\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  return key === "userId" ? match[1] : match[2];
}

export function PlatformShellClient() {
  const params = useParams<{ userId?: string; name?: string }>();
  const searchParams = useSearchParams();
  const userId = decodeURIComponent(searchParams.get("userId") ?? params.userId ?? paramFromPath("userId") ?? "placeholder");
  const name = decodeURIComponent(searchParams.get("name") ?? params.name ?? paramFromPath("name") ?? "placeholder");

  return <PlatformShell userId={userId} name={name} />;
}
