"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { NativeDevelopmentEntry } from "@localapp/dsh-app-development/ui/development-entry";
import { CreateApplicationDialog } from "@/components/development/create-application-dialog";
import { Button } from "@/components/ui/button";

export default function Page() {
  const [creating, setCreating] = useState(false);
  return <>
    <NativeDevelopmentEntry createAction={<Button onClick={() => setCreating(true)}><Plus />创建应用</Button>} />
    <CreateApplicationDialog open={creating} onOpenChange={setCreating} />
  </>;
}
