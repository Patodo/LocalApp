import { Suspense } from "react";
import { PlatformShellClient } from "./client";

export function generateStaticParams() {
  return [{ userId: "placeholder", name: "placeholder" }];
}

export default function PlatformShellPage() {
  return (
    <Suspense fallback={null}>
      <PlatformShellClient />
    </Suspense>
  );
}
