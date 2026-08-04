import { describe, expect, it } from "vitest";
import { filterIssueTimeline, groupIssueTimeline } from "./issue-timeline-group";
import type { IssueTimelineItem } from "./issue-types";

const event = (id: number, actorId = "alice", type = "edited"): IssueTimelineItem => ({
  kind: "event",
  event: { id, issue_id: 1, actor_id: actorId, event_type: type, payload_json: "{}", created_at: `2026-07-10T10:0${id}:00.000Z` },
});
const comment = (id: number): IssueTimelineItem => ({
  kind: "comment",
  comment: { id, issue_id: 1, body: "break", author_id: "bob", created_at: "2026-07-10T10:03:00.000Z", updated_at: "2026-07-10T10:03:00.000Z", deleted_at: null },
});

describe("groupIssueTimeline", () => {
  it("groups adjacent edits from the same actor without reordering events", () => {
    expect(groupIssueTimeline([event(1), event(2), event(3)])).toEqual([{
      kind: "event-group",
      groupType: "edited",
      key: "edited-1-3",
      actorId: "alice",
      events: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 3 })],
    }]);
  });

  it("does not group across comments, non-edit events, or actor boundaries", () => {
    const timeline = [event(1), comment(7), event(2), event(3, "bob"), event(4, "bob", "closed"), event(5, "bob")];
    expect(groupIssueTimeline(timeline)).toEqual(timeline);
  });

  it("keeps single edits as normal event items", () => {
    expect(groupIssueTimeline([event(1)])).toEqual([event(1)]);
  });

  it("compacts four or more adjacent non-edit events without losing their order", () => {
    const events = [event(10, "alice", "locked"), event(11, "alice", "unlocked"), event(12, "bob", "closed"), event(13, "bob", "reopened")];
    expect(groupIssueTimeline(events)).toEqual([{
      kind: "event-group",
      groupType: "history",
      key: "history-10-13",
      actorId: null,
      events: events.map((item) => item.kind === "event" ? item.event : never()),
    }]);
  });

  it("keeps short history runs visible and treats comments and edits as boundaries", () => {
    const timeline = [event(10, "alice", "locked"), event(11, "alice", "unlocked"), comment(7), event(12, "alice", "closed"), event(13, "alice", "reopened"), event(14), event(15), event(16, "alice", "locked"), event(17, "alice", "unlocked")];
    const grouped = groupIssueTimeline(timeline);
    expect(grouped.slice(0, 3)).toEqual(timeline.slice(0, 3));
    expect(grouped[3]).toEqual(event(12, "alice", "closed"));
    expect(grouped[4]).toEqual(event(13, "alice", "reopened"));
    expect(grouped[5]).toEqual(expect.objectContaining({ kind: "event-group", groupType: "edited", key: "edited-14-15" }));
    expect(grouped.slice(6)).toEqual(timeline.slice(7));
  });

  it("keeps the actor on a history batch when every event has the same actor", () => {
    expect(groupIssueTimeline([event(20, "alice", "locked"), event(21, "alice", "unlocked"), event(22, "alice", "closed"), event(23, "alice", "reopened")])).toEqual([
      expect.objectContaining({ kind: "event-group", groupType: "history", actorId: "alice" }),
    ]);
  });
});

function never(): never {
  throw new Error("Unexpected timeline item");
}

describe("filterIssueTimeline", () => {
  const timeline = [event(1), comment(7), event(2), comment(8)];

  it("keeps comments or history in original order", () => {
    expect(filterIssueTimeline(timeline, "comments")).toEqual([comment(7), comment(8)]);
    expect(filterIssueTimeline(timeline, "history")).toEqual([event(1), event(2)]);
  });

  it("returns the complete timeline for all activity without mutating input", () => {
    expect(filterIssueTimeline(timeline, "all")).toEqual(timeline);
    expect(timeline).toEqual([event(1), comment(7), event(2), comment(8)]);
  });
});
