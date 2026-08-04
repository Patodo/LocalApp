"use client";

import { useEffect, useId, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IssueDetailSkeleton() {
  return <div role="status" aria-label="正在加载 Issue 详情" className="min-h-0 flex-1 overflow-hidden px-5 py-5 sm:px-6"><span className="sr-only">正在加载 Issue 详情</span><div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]"><div className="space-y-3 border-b pb-5 lg:col-span-2"><div className="h-9 w-2/3 rounded bg-muted motion-safe:animate-pulse" /><div className="h-7 w-56 rounded bg-muted/70 motion-safe:animate-pulse" /></div><main className="space-y-5"><div className="overflow-hidden rounded-[6px] border"><div className="h-14 border-b bg-muted/30 motion-safe:animate-pulse" /><div className="space-y-3 p-4"><div className="h-4 w-full rounded bg-muted motion-safe:animate-pulse" /><div className="h-4 w-5/6 rounded bg-muted motion-safe:animate-pulse" /><div className="h-4 w-1/2 rounded bg-muted motion-safe:animate-pulse" /></div></div>{Array.from({ length: 2 }, (_, index) => <div key={index} className="h-20 rounded-[6px] border bg-muted/20 motion-safe:animate-pulse" />)}</main><aside className="hidden space-y-6 border-l pl-6 lg:block">{Array.from({ length: 4 }, (_, index) => <div key={index} className="space-y-2"><div className="h-3 w-20 rounded bg-muted" /><div className="h-7 w-32 rounded bg-muted/70 motion-safe:animate-pulse" /></div>)}</aside></div></div>;
}

export function IssueDetailError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const headingId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <div role="alert" aria-labelledby={headingId} aria-describedby={descriptionId} className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"><CircleAlert className="h-10 w-10 text-destructive" aria-hidden="true" /><h3 ref={headingRef} id={headingId} tabIndex={-1} className="mt-3 text-base font-semibold outline-none">无法加载 Issue 详情</h3><p id={descriptionId} className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p><div className="mt-4 flex gap-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" aria-label="从错误页返回 Issue 列表" onClick={onBack}>返回列表</Button><Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" aria-label="重试加载 Issue 详情" onClick={onRetry}>重试</Button></div></div>;
}
