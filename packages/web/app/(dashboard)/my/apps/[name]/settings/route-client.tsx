"use client";

import { usePathname } from "next/navigation";
import { AppSettingsPage } from "@/components/app-settings/app-settings-page";

export function AppSettingsRoute() {
  const parts = usePathname().split("/").filter(Boolean);
  const name = decodeURIComponent(parts[2] || "");
  return <AppSettingsPage name={name} />;
}
