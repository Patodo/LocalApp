import { cloneElement, isValidElement, type ReactNode } from "react";
import { initialForIdentity } from "./issue-identity";
import type { IssueUserIdentity } from "./issue-types";
import { IssueTime } from "./issue-time";

interface IssueActorProps {
  identity: IssueUserIdentity;
  timestamp?: string;
  timestampHref?: string;
  timestampSuffix?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}

export function IssueActor({ identity, timestamp, timestampHref, timestampSuffix, badge, action }: IssueActorProps) {
  const displayName = identity.displayName?.trim() || identity.name?.trim() || identity.id || "未知用户";
  const localizedBadge = badge === "Author" ? "作者" : badge;
  const localizedTimestampSuffix = isValidElement<{ children?: ReactNode }>(timestampSuffix) && timestampSuffix.props.children === "edited"
    ? cloneElement(timestampSuffix, { children: "已编辑" })
    : timestampSuffix;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {identity.avatarUrl ? (
        <img src={identity.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {initialForIdentity(identity)}
        </span>
      )}
      <div className="min-w-0 flex-1 text-xs leading-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <strong className="break-words text-sm font-semibold text-foreground">{displayName}</strong>
          <span className="break-all text-muted-foreground">@{identity.id || "未知"}</span>
          {localizedBadge && <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-medium leading-4 text-muted-foreground">{localizedBadge}</span>}
        </div>
        {timestamp && <div className="flex flex-wrap items-center gap-x-1.5"><IssueTime timestamp={timestamp} href={timestampHref} className="text-muted-foreground hover:underline" />{localizedTimestampSuffix}</div>}
      </div>
      {action && <div data-localapp-issue-actor-action className="shrink-0 self-start">{action}</div>}
    </div>
  );
}
