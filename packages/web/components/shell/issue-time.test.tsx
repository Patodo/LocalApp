import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueTime, formatIssueRelativeTime } from "./issue-time";

const NOW = new Date("2026-07-11T12:00:00.000Z").getTime();

describe("formatIssueRelativeTime", () => {
  it("formats recent activity at stable boundaries", () => {
    expect(formatIssueRelativeTime("2026-07-11T11:59:31.000Z", NOW)).toBe("刚刚");
    expect(formatIssueRelativeTime("2026-07-11T11:58:00.000Z", NOW)).toBe("2分钟前");
    expect(formatIssueRelativeTime("2026-07-11T10:00:00.000Z", NOW)).toBe("2小时前");
    expect(formatIssueRelativeTime("2026-07-09T12:00:00.000Z", NOW)).toBe("2天前");
  });

  it("uses a calendar date after 30 days and preserves invalid input", () => {
    const old = "2026-06-01T12:00:00.000Z";
    expect(formatIssueRelativeTime(old, NOW)).toBe(new Date(old).toLocaleDateString());
    expect(formatIssueRelativeTime("not-a-time", NOW)).toBe("not-a-time");
  });
});

describe("IssueTime", () => {
  it("renders relative linked time with precise semantic metadata", () => {
    const timestamp = "2026-07-11T10:00:00.000Z";
    render(<IssueTime timestamp={timestamp} href="/issue/comment" now={NOW} />);
    const link = screen.getByRole("link", { name: "2小时前" });
    expect(link).toHaveAttribute("href", "/issue/comment");
    expect(link).toHaveClass("h-11", "sm:h-6");
    expect(link.querySelector("time")).toHaveAttribute("datetime", timestamp);
    expect(link.querySelector("time")).toHaveAttribute("title", new Date(timestamp).toLocaleString());
  });

  it("keeps audit timestamps precise", () => {
    const timestamp = "2026-07-11T10:00:00.000Z";
    render(<IssueTime timestamp={timestamp} precise />);
    expect(screen.getByText(new Date(timestamp).toLocaleString())).toHaveAttribute("datetime", timestamp);
  });
});
