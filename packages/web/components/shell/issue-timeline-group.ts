import type { IssueEvent, IssueTimelineItem } from "./issue-types";

export type IssueTimelineFilter = "all" | "comments" | "history";

export type IssueTimelineDisplayItem = IssueTimelineItem | {
  kind: "event-group";
  groupType: "edited" | "history";
  key: string;
  actorId: string | null;
  events: IssueEvent[];
};

export const ISSUE_HISTORY_BATCH_THRESHOLD = 4;

export function filterIssueTimeline(timeline: readonly IssueTimelineItem[], filter: IssueTimelineFilter): IssueTimelineItem[] {
  if (filter === "all") return [...timeline];
  return timeline.filter((item) => filter === "comments" ? item.kind === "comment" : item.kind !== "comment");
}

export function groupIssueTimeline(timeline: readonly IssueTimelineItem[]): IssueTimelineDisplayItem[] {
  const grouped: IssueTimelineDisplayItem[] = [];
  for (let index = 0; index < timeline.length;) {
    const item = timeline[index];
    if (item.kind !== "event") {
      grouped.push(item);
      index += 1;
      continue;
    }
    if (item.event.event_type !== "edited") {
      const events = [item.event];
      let cursor = index + 1;
      while (cursor < timeline.length) {
        const next = timeline[cursor];
        if (next.kind !== "event" || next.event.event_type === "edited") break;
        events.push(next.event);
        cursor += 1;
      }
      if (events.length < ISSUE_HISTORY_BATCH_THRESHOLD) {
        grouped.push(...timeline.slice(index, cursor));
      } else {
        const actorId = events.every((event) => event.actor_id === events[0].actor_id) ? events[0].actor_id : null;
        grouped.push({ kind: "event-group", groupType: "history", key: `history-${events[0].id}-${events.at(-1)!.id}`, actorId, events });
      }
      index = cursor;
      continue;
    }
    const events = [item.event];
    let cursor = index + 1;
    while (cursor < timeline.length) {
      const next = timeline[cursor];
      if (next.kind !== "event" || next.event.event_type !== "edited" || next.event.actor_id !== item.event.actor_id) break;
      events.push(next.event);
      cursor += 1;
    }
    if (events.length < 2) grouped.push(item);
    else grouped.push({ kind: "event-group", groupType: "edited", key: `edited-${events[0].id}-${events.at(-1)!.id}`, actorId: item.event.actor_id, events });
    index = cursor;
  }
  return grouped;
}
