import { Suspense } from "react";
import { PlatformShellClient } from "../platform-shell/[userId]/[name]/client";

export default function PlatformShellPreviewPage() {
  return (
    <Suspense fallback={null}>
      <PlatformShellClient />
    </Suspense>
  );
}
